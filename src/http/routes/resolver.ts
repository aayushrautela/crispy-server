import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import {
  ChainError,
  corsState,
  DEFAULT_PROBE_ORIGIN,
  describeTerminalHop,
  parseResolvableUrl,
  USER_AGENT,
  type FetchLike,
} from '../../modules/resolver/chain.js';
import {
  pickForwardableHeaders,
  ResolverService,
  type WalkOutcome,
} from '../../modules/resolver/resolver.service.js';
import { InMemoryRateLimitStore, type RateLimitStore } from '../../modules/apps/app-rate-limit.service.js';
import { resolveUrlQueryRouteSchema, resolveUrlRouteSchema, streamRouteSchema } from '../contracts/resolver.js';

/**
 * Public endpoints the player calls before playback. They sit on the API
 * server rather than an edge function because the walk sometimes has to leave
 * the datacenter (SOCKS5 proxy) and because one deployment shared by the
 * resolver and the byte proxy keeps the CORS story a single origin.
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

/**
 * Request headers the upstream needs and the browser must not control.
 * Bearer tokens from `headers` are kept OUT of this path when a redirect
 * happened: the client worker only sends them for no-redirect URLs anyway,
 * and a CDN redirect carries its own token.
 */
const PASSTHROUGH_REQUEST_HEADERS = ['range', 'if-range', 'if-none-match', 'accept'];

/** Bounds only the handshake — time to first byte of the media replay. */
const STREAM_TIMEOUT_MS = 30_000;

/** Per-IP limits: the endpoints are public and unauthenticated. */
const RESOLVE_LIMIT_PER_MINUTE = 60;
const STREAM_LIMIT_PER_MINUTE = 120;

const STREAM_HEADERS_TO_COPY = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
];

const RESOLVER_RESPONSE_HEADERS: Record<string, string> = {
  'Cache-Control': NO_STORE,
};

const STREAM_FAILURE_HEADERS: Record<string, string> = {
  'Cache-Control': NO_STORE,
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Crispy-Reason, X-Crispy-Hops',
};

export interface ResolverRoutesDeps {
  resolver?: ResolverService;
  rateLimitStore?: RateLimitStore;
  /** Direct replay of the resolved media URL; injected in tests. */
  mediaFetch?: FetchLike;
}

export async function registerResolverRoutes(
  app: FastifyInstance,
  deps: ResolverRoutesDeps = {},
): Promise<void> {
  const resolver = deps.resolver ?? new ResolverService();
  const rateLimitStore = deps.rateLimitStore ?? new InMemoryRateLimitStore();
  const mediaFetch: FetchLike = deps.mediaFetch ?? fetch;

  function respond(reply: FastifyReply, body: Record<string, unknown>, status = 200): FastifyReply {
    for (const [name, value] of Object.entries(RESOLVER_RESPONSE_HEADERS)) {
      reply.header(name, value);
    }
    return reply.code(status).send(body);
  }

  function failure(reply: FastifyReply, reason: string, message: string, status: number): FastifyReply {
    reply.header('X-Crispy-Reason', reason);
    for (const [name, value] of Object.entries(STREAM_FAILURE_HEADERS)) {
      reply.header(name, value);
    }
    return reply.code(status).send({ error: message, reason });
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

    // Do not pull the media itself; the player (or /v1/stream) does that.
    void result.response?.body?.cancel().catch(() => {});

    const cors = corsState(result.response);
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

  /**
   * The walk's decision: 'cors' means browser-readable, anything else means
   * the player must come here for the bytes. The server reports that
   * capability; the client chooses.
   */
  const streamHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }

    const retryAfter = await checkRateLimit(`resolver:stream:${request.ip}`, STREAM_LIMIT_PER_MINUTE);
    if (retryAfter !== null) {
      reply.header('Retry-After', String(retryAfter));
      return failure(reply, 'rate-limited', 'Too many stream requests', 429);
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const rawUrl = typeof query.url === 'string' ? query.url : '';
    if (!rawUrl) {
      return failure(reply, 'missing-url', 'Missing url', 400);
    }

    let target: URL;
    try {
      target = parseResolvableUrl(rawUrl);
    } catch (error) {
      const reason = error instanceof ChainError ? error.reason : 'malformed';
      return failure(reply, reason, (error as Error).message, 400);
    }

    const clientHeaders = readHeadersParam(query.headers);
    for (const name of PASSTHROUGH_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === 'string' && value.length > 0) clientHeaders[name] = value;
    }

    let outcome: WalkOutcome;
    try {
      outcome = await resolver.walk(target, clientHeaders);
    } catch (error) {
      const { reason } = reasonFromChainError(error);
      return failure(reply, reason, (error as Error).message, 502);
    }

    const result = outcome.result;

    // The walk deliberately asked for a single byte: its job is to find the
    // URL the media actually lives at, not to move it. So its terminal
    // response cannot be streamed back — the client's own `Range` has to be
    // replayed against the final URL. The replay is hardcoded direct: media
    // bytes never go through the residential proxy, only the walk ever did.
    //
    // HEAD from the client is never replayed as HEAD: presigned object-store
    // URLs (R2/S3) sign the HTTP method, so a HEAD against a GET-signed URL
    // gets a 403 even though the object is perfectly readable. A one-byte
    // Range GET returns the same headers for any store, signed or not.
    const isHead = request.method === 'HEAD';
    const replayHeaders: Record<string, string> = { 'User-Agent': USER_AGENT, ...clientHeaders };
    if (isHead && !Object.keys(replayHeaders).some((name) => name.toLowerCase() === 'range')) {
      replayHeaders.Range = 'bytes=0-0';
    }

    let upstream: Response;
    try {
      upstream = await mediaFetch(result.url, {
        method: 'GET',
        redirect: 'follow',
        headers: replayHeaders,
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = /timeout|abort/i.test(String((error as Error).message)) ? 'timeout' : 'unreachable';
      return failure(reply, 'unreachable', `Could not read the resolved URL: ${(error as Error).message}`, 502);
    }

    // The probe response is dead weight now, and its byte is not the media.
    void result.response?.body?.cancel().catch(() => {});

    if (!upstream.ok && upstream.status !== 206) {
      void upstream.body?.cancel().catch(() => {});
      return failure(reply, `status-${upstream.status}`, `Upstream responded ${upstream.status}`, 502);
    }

    for (const name of STREAM_HEADERS_TO_COPY) {
      const value = upstream.headers.get(name);
      if (value) reply.header(name, value);
    }
    if (!reply.hasHeader('accept-ranges')) reply.header('accept-ranges', 'bytes');

    // Surfaced on the response so a failing source explains itself in
    // devtools instead of just not playing.
    reply.header('X-Crispy-Reason', 'proxied');
    reply.header('X-Crispy-Hops', String(result.hops.length));
    reply.header('X-Crispy-Source', new URL(result.url).hostname);
    reply.code(upstream.status === 206 ? 206 : 200);

    if (request.method === 'HEAD') {
      // The replay was a one-byte probe; only its headers go back. A 206
      // probe's content-range carries the object size callers actually want
      // from a HEAD — answer 200 with that as content-length, and never leak
      // the probe's own one-byte length.
      const rangeTotal = upstream.status === 206
        ? /^bytes \d+-\d+\/(\d+)$/.exec(upstream.headers.get('content-range') ?? '')?.[1]
        : undefined;
      if (rangeTotal) {
        reply.code(200);
        reply.header('content-length', rangeTotal);
      } else {
        reply.removeHeader('content-length');
      }
      void upstream.body?.cancel().catch(() => {});
      return reply.send();
    }
    if (!upstream.body) {
      return reply.send();
    }

    // Streaming: the body goes straight through without being buffered, so a
    // long file costs one open response rather than one huge allocation.
    return reply.send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]));
  };

  app.get('/v1/stream', { schema: streamRouteSchema }, streamHandler);
}
