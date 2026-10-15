import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ChainError,
  corsState,
  DEFAULT_PROBE_ORIGIN,
  describeTerminalHop,
  parseResolvableUrl,
} from '../../modules/resolver/chain.js';
import {
  pickForwardableHeaders,
  ResolverService,
  type WalkOutcome,
} from '../../modules/resolver/resolver.service.js';
import { InMemoryRateLimitStore, type RateLimitStore } from '../../modules/apps/app-rate-limit.service.js';
import { resolveUrlQueryRouteSchema, resolveUrlRouteSchema } from '../contracts/resolver.js';

/**
 * Public endpoint the player calls before playback. It sits on the API server
 * rather than an edge function because the walk sometimes has to leave the
 * datacenter (SOCKS5 proxy), and co-deploying keeps the CORS story a single
 * origin.
 *
 * Resolution is URL-only by design: media bytes never transit this server.
 * The player always fetches the media itself — browser-readable URLs directly,
 * browser-unreadable URLs through the local streaming engine on the user's own
 * machine.
 *
 * The response shape is flat ({url, cors, reason, hops, …}) — the contract
 * the web player's URL resolver worker was built against. The API-wide
 * {data, meta} envelope is deliberately not applied here; these are
 * infrastructure endpoints, not account data.
 */

type ResolveReason =
  | 'cors-ok'
  | 'proxy-required'
  | 'no-redirect'
  | 'json-url'
  | 'html-response'
  | 'image-response'
  | 'cloudflare-challenge'
  | 'blocked-host'
  | 'bad-scheme'
  | 'too-long'
  | 'too-many-redirects'
  | 'redirect-blocked'
  | 'json-blocked'
  | 'malformed'
  | 'missing-url'
  | 'method-not-allowed'
  | 'unreachable'
  | 'timeout'
  | 'rate-limited';

/** Resolved URLs carry short-lived tokens; never let a cache keep them. */
const NO_STORE = 'no-store';

/** Per-IP limits: the endpoint is public and unauthenticated. */
const RESOLVE_LIMIT_PER_MINUTE = 60;

const RESOLVER_RESPONSE_HEADERS: Record<string, string> = {
  'Cache-Control': NO_STORE,
};

export interface ResolverRoutesDeps {
  resolver?: ResolverService;
  rateLimitStore?: RateLimitStore;
}

export async function registerResolverRoutes(
  app: FastifyInstance,
  deps: ResolverRoutesDeps = {},
): Promise<void> {
  const resolver = deps.resolver ?? new ResolverService();
  const rateLimitStore = deps.rateLimitStore ?? new InMemoryRateLimitStore();

  function respond(reply: FastifyReply, body: Record<string, unknown>, status = 200): FastifyReply {
    for (const [name, value] of Object.entries(RESOLVER_RESPONSE_HEADERS)) {
      reply.header(name, value);
    }
    return reply.code(status).send(body);
  }

  /** Returns retryAfterSeconds when the caller is over the fixed-window limit. */
  async function checkRateLimit(key: string, limit: number): Promise<number | null> {
    const { count, resetAt } = await rateLimitStore.increment({
      key,
      windowSeconds: 60,
      cost: 1,
      now: new Date(),
    });
    if (count <= limit) return null;
    return Math.max(Math.ceil((resetAt.getTime() - Date.now()) / 1000), 1);
  }

  function probeOrigin(request: FastifyRequest, declared: unknown): string {
    if (typeof declared === 'string' && /^https?:\/\//i.test(declared)) return declared;
    return request.headers.origin ?? DEFAULT_PROBE_ORIGIN;
  }

  function readHeadersParam(raw: unknown): Record<string, string> {
    if (typeof raw !== 'string' || raw.length === 0) return {};
    try {
      return pickForwardableHeaders(JSON.parse(raw) as unknown);
    } catch {
      return {};
    }
  }

  function reasonFromChainError(error: unknown): { reason: ResolveReason; timedOut: boolean } {
    const reason = (error instanceof ChainError ? error.reason : 'unreachable') as ResolveReason;
    const timedOut = /timeout|abort/i.test(String((error as Error).message));
    return { reason: timedOut ? 'timeout' : reason, timedOut };
  }

  app.post(
    '/v1/resolve-url',
    { schema: resolveUrlRouteSchema },
    async (request, reply) => {
      const retryAfter = await checkRateLimit(`resolver:resolve:${request.ip}`, RESOLVE_LIMIT_PER_MINUTE);
      if (retryAfter !== null) {
        reply.header('Retry-After', String(retryAfter));
        return respond(
          reply,
          { reason: 'rate-limited' satisfies ResolveReason, error: 'Too many resolve requests' },
          429,
        );
      }

      const body = (request.body ?? {}) as Record<string, unknown>;
      const inputUrl = typeof body.url === 'string' ? body.url : '';

      // GET query-string fallback for the rare caller that cannot POST JSON.
      if (!inputUrl && request.query && typeof request.query === 'object') {
        const query = request.query as Record<string, unknown>;
        if (typeof query.url === 'string') {
          return handleResolve(reply, query.url, readHeadersParam(query.headers), probeOrigin(request, query.origin));
        }
      }

      if (!inputUrl) {
        return respond(reply, { reason: 'missing-url' satisfies ResolveReason, error: 'Missing url' }, 400);
      }

      return handleResolve(
        reply,
        inputUrl,
        pickForwardableHeaders(body.headers),
        probeOrigin(request, body.origin),
      );
    },
  );

  app.get('/v1/resolve-url', { schema: resolveUrlQueryRouteSchema }, async (request, reply) => {
    const retryAfter = await checkRateLimit(`resolver:resolve:${request.ip}`, RESOLVE_LIMIT_PER_MINUTE);
    if (retryAfter !== null) {
      reply.header('Retry-After', String(retryAfter));
      return respond(
        reply,
        { reason: 'rate-limited' satisfies ResolveReason, error: 'Too many resolve requests' },
        429,
      );
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const inputUrl = typeof query.url === 'string' ? query.url : '';
    if (!inputUrl) {
      return respond(reply, { reason: 'missing-url' satisfies ResolveReason, error: 'Missing url' }, 400);
    }

    return handleResolve(reply, inputUrl, readHeadersParam(query.headers), probeOrigin(request, query.origin));
  });

  async function handleResolve(
    reply: FastifyReply,
    inputUrl: string,
    headers: Record<string, string>,
    origin: string,
  ): Promise<FastifyReply> {
    let target: URL;
    try {
      target = parseResolvableUrl(inputUrl);
    } catch (error) {
      const reason = ((error instanceof ChainError ? error.reason : 'malformed') as ResolveReason) || 'malformed';
      // Fall back to the original URL: a resolver we refuse must not cost the
      // user their play, even though it also will not be fixed by this.
      return respond(reply, {
        url: inputUrl,
        cors: false,
        reason,
        hops: [],
        error: (error as Error).message,
      });
    }

    let outcome: WalkOutcome;
    try {
      outcome = await resolver.walk(target, headers, origin);
    } catch (error) {
      const { reason } = reasonFromChainError(error);
      return respond(reply, {
        url: inputUrl,
        cors: false,
        reason,
        hops: [],
        error: (error as Error).message,
      });
    }

    const { result } = outcome;
    const terminal = describeTerminalHop(result);
    if (terminal) {
      // The chain ended on something that is not media: a Cloudflare
      // interstitial, an error page, a "file not found" video.
      return respond(reply, {
        url: inputUrl,
        cors: false,
        reason: terminal as ResolveReason,
        hops: result.hops,
        resolved: false,
        error: `Chain ended on ${terminal}`,
      });
    }

    // Media bytes never transit this server; the player fetches the returned
    // URL itself (directly, or via the local streaming engine for
    // browser-unreadable URLs).
    void result.response?.body?.cancel().catch(() => {});

    let cors = corsState(result.response);
    if (cors === 'cors') {
      // The player loads with a Range header, so its fetch is preflighted.
      // A GET answer that advertises CORS while OPTIONS answers nothing
      // (pixeldrain-style CDNs) would be certified readable and then fail in
      // the player; a definitive preflight refusal downgrades it here so the
      // local engine re-serves instead.
      const preflight = await resolver.preflight(result.url, origin);
      if (preflight === false) cors = 'not-cors';
    }
    const redirected = result.url !== inputUrl;

    return respond(reply, {
      url: result.url,
      cors: cors === 'cors',
      // 'cors-ok' means the browser can read the final URL directly; the
      // no-redirect variant means the addon already handed us a readable one.
      reason: (!redirected && cors === 'cors'
        ? 'no-redirect'
        : cors === 'cors'
          ? 'cors-ok'
          : 'proxy-required') satisfies ResolveReason,
      hops: result.hops,
      resolved: redirected,
      viaJson: result.viaJson ?? result.hops.some((hop) => hop.note === 'json-url'),
    });
  }
}
