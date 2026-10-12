/**
 * Decision layer over the redirect-chain walk.
 *
 * The walk is run directly first. When a host refuses that — a 4xx/5xx, a
 * Cloudflare challenge, an HTML or image terminal page, or a timeout — the
 * same walk is retried once through the SOCKS5 proxy, and the outcome is
 * remembered for that hostname for a day so the next request goes straight
 * down the path that worked.
 *
 * The proxy is only ever used for the walk, which asks for a single byte per
 * hop. Media bytes are always fetched directly: residential bandwidth is
 * billed per gigabyte, and a whole film would bankrupt the whole idea.
 */

import {
  ChainError,
  describeTerminalHop,
  followChain,
  FORWARDABLE_HEADERS,
  type ChainResult,
  type FetchLike,
} from './chain.js';
import type { ProxyConfig } from './proxy.js';

export type ResolverTransport = 'direct' | 'proxy';

export type WalkOutcome = {
  result: ChainResult;
  transport: ResolverTransport;
};

/** Cache entry lifetime for a host's working transport. */
const TRANSPORT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Keep the in-memory cache bounded; a long-running process would leak hostnames. */
const TRANSPORT_CACHE_MAX_ENTRIES = 5000;

type TransportDecision = {
  transport: ResolverTransport;
  expiresAt: number;
};

/**
 * Keeps only the few auth headers a debrid resolver actually needs, lowercased
 * and non-empty. Anything else the client supplied is dropped on purpose:
 * these values are forwarded to third-party hosts.
 */
export function pickForwardableHeaders(candidate: unknown): Record<string, string> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(candidate as Record<string, unknown>)) {
    const lower = name.toLowerCase();
    if (!FORWARDABLE_HEADERS.includes(lower)) continue;
    if (typeof value !== 'string' || value.length === 0) continue;
    headers[lower] = value;
  }
  return headers;
}

export type ResolverServiceOptions = {
  proxy?: ProxyConfig | null;
  directFetch?: FetchLike;
  now?: () => number;
};

export class ResolverService {
  private readonly proxy: ProxyConfig | null;
  private readonly directFetch: FetchLike;
  private readonly now: () => number;
  private readonly decisions = new Map<string, TransportDecision>();

  constructor(options: ResolverServiceOptions = {}) {
    this.proxy = options.proxy ?? null;
    this.directFetch = options.directFetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  get transportMode(): 'proxy' | 'direct-only' {
    return this.proxy ? 'proxy' : 'direct-only';
  }

  get proxyLabel(): string | null {
    return this.proxy?.label ?? null;
  }

  /**
   * Walks the chain to a readable terminal response, retrying through the
   * proxy when the direct walk was refused. Throws only when every available
   * transport failed to complete a walk; a chain that completed and ended on
   * a refusal page is a *result*, not a throw — the caller reports the
   * terminal reason from it.
   */
  async walk(
    start: URL,
    clientHeaders: Record<string, string> = {},
    origin?: string,
  ): Promise<WalkOutcome> {
    const host = start.hostname;
    const transports = this.transportOrder(host);

    let refusal: WalkOutcome | null = null;
    let failure: unknown = null;

    for (const transport of transports) {
      try {
        const result = await followChain(start, clientHeaders, origin, this.fetchFor(transport));
        if (describeTerminalHop(result) === null) {
          this.remember(host, transport);
          return { result, transport };
        }
        refusal ??= { result, transport };
      } catch (error) {
        failure ??= error;
      }
    }

    if (refusal) return refusal;
    throw failure instanceof Error ? failure : new ChainError('unreachable', 'The chain walk failed');
  }

  private transportOrder(host: string): ResolverTransport[] {
    if (!this.proxy) return ['direct'];
    return this.cachedTransport(host) === 'proxy' ? ['proxy', 'direct'] : ['direct', 'proxy'];
  }

  private fetchFor(transport: ResolverTransport): FetchLike {
    return transport === 'proxy' ? (this.proxy as ProxyConfig).fetch : this.directFetch;
  }

  private cachedTransport(host: string): ResolverTransport | null {
    const decision = this.decisions.get(host);
    if (!decision) return null;
    if (decision.expiresAt <= this.now()) {
      this.decisions.delete(host);
      return null;
    }
    return decision.transport;
  }

  private remember(host: string, transport: ResolverTransport): void {
    if (this.decisions.size >= TRANSPORT_CACHE_MAX_ENTRIES) {
      const oldest = this.decisions.keys().next();
      if (!oldest.done) this.decisions.delete(oldest.value);
    }
    this.decisions.set(host, { transport, expiresAt: this.now() + TRANSPORT_CACHE_TTL_MS });
  }
}
