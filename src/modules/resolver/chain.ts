/**
 * Shared redirect-chain walking for the resolver endpoint.
 *
 * `/v1/resolve-url` follows whatever chain an addon handed us, one hop at a
 * time, and ends up at a URL that serves media — but only ever learns *where*
 * it lives and whether a browser can read it. Media bytes never transit this
 * server: the player fetches the final URL itself, or a browser-unreadable
 * URL through the local streaming engine on the user's own machine.
 *
 * Deliberately provider-agnostic. Nothing here knows the name of any debrid
 * service or addon. The chain is whatever the addon returned, and the only
 * question asked about the result is a capability question — does this URL send
 * CORS headers a browser can use?
 *
 * The fetch implementation is injectable so the walk can be rerun through a
 * SOCKS proxy when a resolver host refuses datacenter traffic (see
 * resolver.service.ts). Even then, only the one-byte probes cross the proxy.
 */

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Sent on every hop. Most Stremio resolver hosts sit behind Cloudflare, which
 * fingerprints the client; a thin, obviously-server request is the easiest way
 * to get answered with a challenge page instead of a redirect. This is about
 * looking like the browser that a real user would be, not about evading any
 * specific protection.
 */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
};

/** Only these hop past the client, and only when the client supplied them. */
export const FORWARDABLE_HEADERS = ['authorization', 'x-api-key', 'x-auth-token'];

/**
 * Origin used for the probe when the caller could not tell us theirs.
 *
 * CDNs overwhelmingly emit `Access-Control-Allow-Origin` **only when the request
 * carries an `Origin`**, reflecting whatever they are sent — probe without one
 * and every provider looks like it hides its headers. This is the app's own
 * origin, used when the caller's could not be determined.
 */
export const DEFAULT_PROBE_ORIGIN = 'https://web.crispytv.tech';

export const MAX_REDIRECTS = 8;
export const HOP_TIMEOUT_MS = 8000;
export const MAX_URL_LENGTH = 8192;
export const MAX_JSON_BYTES = 64 * 1024;

/**
 * Hard ceiling for one full walk (all transports combined). Without it the
 * worst case is (MAX_REDIRECTS + 1) x HOP_TIMEOUT per transport — far past
 * the caller's own timeout, so the client aborts while the server keeps
 * walking a chain nobody will read.
 */
export const WALK_DEADLINE_MS = 12_000;

/**
 * A single OPTIONS probe against the final URL. Short: the host just answered
 * a GET moments ago, so a slow preflight answer is a broken endpoint, not a
 * busy one.
 */
export const PREFLIGHT_TIMEOUT_MS = 5000;

export interface ChainHop {
  url: string;
  status: number;
  location: string | null;
  note?: string;
}

export interface ChainResult {
  /** Final URL, after every redirect (and any JSON indirection) resolved. */
  url: string;
  hops: ChainHop[];
  /** Unread body of the final response, or null if it was already consumed. */
  response: Response | null;
  /** Set when a resolver answered with JSON that pointed somewhere else. */
  viaJson?: boolean;
}

export class ChainError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'ChainError';
    this.reason = reason;
  }
}

/**
 * Private/loopback/link-local hosts are refused. This is the SSRF guard for a
 * public endpoint, and it also stops a redirect from bouncing the request back
 * into the deployment's own network.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }

  // IPv6 literals only: a hostname starting "fc" (fcbar.example.com) is public.
  if (host.includes(':')) {
    return (
      host === '::1' ||
      host === '::' ||
      /^f[cd]/.test(host) ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb')
    );
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;

  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return a >= 224;
}

/** Parses and validates a client-supplied URL. Throws `ChainError`. */
export function parseResolvableUrl(rawUrl: string, reasonPrefix = 'malformed'): URL {
  const value = rawUrl.trim();

  if (value.length === 0) throw new ChainError(reasonPrefix, 'Empty URL');
  if (value.length > MAX_URL_LENGTH) throw new ChainError('too-long', 'URL too long');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ChainError(reasonPrefix, 'Malformed URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ChainError('bad-scheme', `Unsupported scheme: ${parsed.protocol}`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new ChainError('blocked-host', `Blocked host: ${parsed.hostname}`);
  }

  return parsed;
}

const URL_KEYS = ['url', 'link', 'fileUrl', 'downloadUrl', 'data', 'stream', 'source'];

/** Digs the first http(s) string out of a resolver that answers with JSON. */
export function extractUrl(value: unknown, depth = 0): string | null {
  if (depth > 3) return null;

  if (typeof value === 'string') {
    const candidate = value.trim();
    return /^https?:\/\//i.test(candidate) ? candidate : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of URL_KEYS) {
      if (!(key in record)) continue;
      const found = extractUrl(record[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') || '').includes('json');
}

async function readJsonUrl(response: Response): Promise<string | null> {
  const contentLength = Number(response.headers.get('content-length') || '0');
  if (contentLength > MAX_JSON_BYTES) return null;

  try {
    const body = await response.text();
    return extractUrl(JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

/** A response with a usable `Access-Control-Allow-Origin` a browser can read. */
export function corsState(response: Response | null): 'cors' | 'not-cors' | 'unknown' {
  if (!response) return 'unknown';
  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (!allowOrigin || allowOrigin === 'null') return 'not-cors';
  return 'cors';
}

/** Case-insensitive membership in a comma-separated CORS allow-list. */
function allowListCovers(value: string | null, entry: string): boolean {
  if (!value) return false;
  const list = value.toLowerCase();
  return list.split(',').some((item) => item.trim() === entry || item.trim() === '*');
}

/**
 * Whether an OPTIONS preflight answer lets the player issue its real request.
 *
 * GET headers alone over-promise: `corsState` inspects the GET answer, but the
 * player fetches with a `Range` header, which makes every cross-origin load
 * preflighted. Some CDNs answer GET with `Access-Control-Allow-Origin: *` and
 * OPTIONS with nothing at all; certifying those as readable only moves the
 * failure into the player. A preflight passes only when the answer explicitly
 * covers the origin, the GET method, and the range header.
 */
export function preflightAllows(response: Response, expectedOrigin?: string): boolean {
  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (allowOrigin !== '*') {
    // A mirrored-origin answer only helps the browser when it echoes exactly
    // the origin the probe (and later the player) sends.
    if (!allowOrigin || allowOrigin === 'null') return false;
    if (expectedOrigin && allowOrigin !== expectedOrigin) return false;
  }
  return (
    allowListCovers(response.headers.get('access-control-allow-methods'), 'get') &&
    allowListCovers(response.headers.get('access-control-allow-headers'), 'range')
  );
}

/**
 * Probes the final URL with the same OPTIONS preflight the browser will send.
 *
 * Returns true/false when the host answered, null when the probe itself
 * failed (DNS, TLS, timeout): a network failure says nothing about CORS, so
 * the GET answer stands. Only a definitive "answered without the preflight
 * contract" downgrades the certified URL.
 */
export async function checkPreflight(
  url: URL,
  origin: string | undefined,
  fetchFn: FetchLike,
  timeoutMs = PREFLIGHT_TIMEOUT_MS,
): Promise<boolean | null> {
  try {
    const response = await fetchFn(url.toString(), {
      method: 'OPTIONS',
      headers: {
        ...(origin ? { Origin: origin } : {}),
        'Access-Control-Request-Method': 'GET',
        // `range` is the header that forces the preflight in the real player.
        'Access-Control-Request-Headers': 'range',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    void response.body?.cancel().catch(() => {});
    return preflightAllows(response, origin);
  } catch {
    return null;
  }
}

/**
 * Walks the chain one hop at a time with `redirect: 'manual'`.
 *
 * Manual rather than `redirect: 'follow'` for two reasons: each hop gets the
 * full browser-shaped header set (a follow() forwards a thinner one and drops
 * `Sec-Fetch-*`), and every hop's status is captured, which is what makes the
 * `reason` codes in the API responses meaningful instead of a shrug.
 *
 * Handles three shapes of indirection, all of them provider-generic:
 *   - 3xx with `Location` (header, absolute or relative)
 *   - 200 with a JSON body containing a URL
 *   - Cloudflare interstitial pages (detected, reported, not followed blindly)
 */
export async function followChain(
  start: URL,
  clientHeaders: Record<string, string> = {},
  origin?: string,
  fetchFn: FetchLike = fetch,
  deadlineAt?: number,
): Promise<ChainResult> {
  const hops: ChainHop[] = [];
  const headers = { ...BROWSER_HEADERS, ...clientHeaders };
  let current = start;

  /** Per-hop timeout, clamped to whatever the overall walk budget has left. */
  const hopSignal = (): AbortSignal => {
    if (deadlineAt === undefined) return AbortSignal.timeout(HOP_TIMEOUT_MS);
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new ChainError('timeout', 'The chain walk ran out of time');
    return AbortSignal.timeout(Math.min(HOP_TIMEOUT_MS, remaining));
  };

  /**
   * A client-supplied `Range` must not ride along on the walk. The `Headers`
   * constructor appends rather than replaces after normalising case, so
   * `range: bytes=0-1023` alongside `Range: bytes=0-0` leaves upstream with
   * `bytes=0-0, bytes=0-1023` — an unsatisfiable range, and a 416. The walk
   * only ever needs headers; the player re-requests the final URL itself.
   */
  const probeHeaders: Record<string, string> = { ...headers };
  for (const name of ['range', 'if-range']) delete probeHeaders[name];

  // See DEFAULT_PROBE_ORIGIN: without an Origin most CDNs send no CORS headers
  // at all, and the capability probe would report every provider as opaque.
  if (origin) probeHeaders.Origin = origin;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchFn(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      // Ask for nothing: enough to learn the headers, never enough to
      // download a feature film through this endpoint.
      headers: { ...probeHeaders, Range: 'bytes=0-0' },
      signal: hopSignal(),
    });

    // Some runtimes hide the redirect behind an opaque response. Nothing to
    // learn from it, so hand the whole chain to fetch() instead.
    if (response.type === 'opaqueredirect' || response.status === 0) {
      hops.push({ url: current.toString(), status: 0, location: null, note: 'opaque-redirect' });
      const followed = await fetchFn(current.toString(), {
        method: 'GET',
        redirect: 'follow',
        headers: { ...probeHeaders, Range: 'bytes=0-0' },
        signal: hopSignal(),
      });
      return { url: followed.url || current.toString(), hops, response: followed };
    }

    const location = response.headers.get('location');
    hops.push({ url: current.toString(), status: response.status, location });

    if (response.status >= 300 && response.status < 400 && location) {
      void response.body?.cancel().catch(() => {});
      current = parseResolvableUrl(new URL(location, current).toString(), 'redirect-blocked');
      continue;
    }

    if (isJson(response)) {
      const extracted = await readJsonUrl(response);
      if (extracted) {
        current = parseResolvableUrl(extracted, 'json-blocked');
        const lastHop = hops.at(-1);
        if (lastHop) lastHop.note = 'json-url';
        continue;
      }
    }

    // Reached the end of the chain. The body is left unread for the caller;
    // /v1/resolve-url only needs the headers and cancels it.
    return { url: response.url || current.toString(), hops, response };
  }

  throw new ChainError('too-many-redirects', `More than ${MAX_REDIRECTS} redirects`);
}

/**
 * Cloudflare and friends answer a blocked request with a 4xx/5xx or a 200
 * carrying an HTML challenge. Neither is a media URL, and pretending otherwise
 * is what makes a failure look like a success.
 */
export function describeTerminalHop(result: ChainResult): string | null {
  const response = result.response;
  if (!response) return null;

  if (response.status >= 400) return `status-${response.status}`;

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) return 'html-response';
  if (contentType.startsWith('image/') && !contentType.includes('mp4')) return 'image-response';

  const server = response.headers.get('server') || '';
  if (/cloudflare/i.test(server) && contentType.includes('text/html')) return 'cloudflare-challenge';

  return null;
}
