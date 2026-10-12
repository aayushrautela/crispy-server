/**
 * Selective SOCKS5 proxy for resolver walks.
 *
 * Some resolver hosts refuse datacenter traffic outright (a bare 403 or a
 * Cloudflare challenge with no redirect) while serving a residential IP fine.
 * Retrying only those hosts through a sticky residential session — rather
 * than everything, and rather than the media itself — keeps the cost floor
 * at zero (no PROXY_URL) and the ceiling small (one headers-only walk).
 *
 * Provider-agnostic on purpose: any SOCKS5 endpoint with sticky sessions
 * works, and the credentials are where session pinning lives, so rotating
 * them is an operation, not a code change.
 */

import { socksDispatcher } from 'fetch-socks';
import type { FetchLike } from './chain.js';

export type ProxyConfig = {
  fetch: FetchLike;
  /** `host:port` of the endpoint, for logs only — never includes credentials. */
  label: string;
};

/**
 * Builds a fetch that routes through the SOCKS5 endpoint in `proxyUrl`.
 *
 * `proxyUrl` shape: `socks5://<user>:<pass>@<host>:<port>` (socks5h is
 * accepted too; resolution is remote either way). A malformed or non-SOCKS
 * URL is a deployment misconfiguration: warn and fail open to direct-only
 * rather than failing the request at boot.
 */
export function buildProxyFetch(
  proxyUrl: string | undefined,
  warn: (message: string) => void = () => {},
): ProxyConfig | null {
  if (!proxyUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    warn(`PROXY_URL is not a valid URL; resolver runs direct-only`);
    return null;
  }

  if (parsed.protocol !== 'socks5:' && parsed.protocol !== 'socks5h:') {
    warn(`PROXY_URL scheme "${parsed.protocol}" is not supported (expected socks5://); resolver runs direct-only`);
    return null;
  }

  const host = parsed.hostname;
  const port = Number(parsed.port || 1080);
  if (!host || !Number.isFinite(port)) {
    warn(`PROXY_URL is missing host or port; resolver runs direct-only`);
    return null;
  }

  const dispatcher = socksDispatcher({
    type: 5,
    host,
    port,
    userId: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  });

  const proxyFetch: FetchLike = (input, init) =>
    fetch(input, { ...init, dispatcher } as RequestInit);

  return {
    fetch: proxyFetch,
    label: `${host}:${port}`,
  };
}
