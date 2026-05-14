import { appConfig } from '../../../config/app-config.js';
import { env } from '../../../config/env.js';
import { HttpError } from '../../../lib/errors.js';

export type TmdbRequestQuery = Record<string, string | number | boolean | undefined | null>;

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MIN_REQUEST_INTERVAL_MS = 40;
const REQUEST_TIMEOUT_MS = 5_000;

let nextRequestAt = 0;

async function waitForRequestSlot(): Promise<void> {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + MIN_REQUEST_INTERVAL_MS;
  const delay = scheduledAt - now;
  if (delay > 0) {
    await sleep(delay);
  }
}

function buildUrl(pathname: string, query: TmdbRequestQuery = {}): URL {
  const url = new URL(`${appConfig.metadata.tmdb.baseUrl.replace(/\/$/, '')}${pathname}`);
  url.searchParams.set('api_key', env.tmdbApiKey);

  for (const [key, value] of Object.entries(query).sort(([left], [right]) => left.localeCompare(right))) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url;
}

function parseRetryAfter(response: Response, body: Record<string, unknown> | null): number | null {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }

  const retryAfter = body?.retry_after;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? retryAfter * 1000 : null;
}

function backoffMs(attempt: number): number {
  return Math.floor(BASE_BACKOFF_MS * 2 ** attempt * (0.75 + Math.random() * 0.5));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (!signal) {
    return AbortSignal.timeout(timeoutMs);
  }
  if (signal.aborted) {
    return signal;
  }
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

export class TmdbClient {
  async request(pathname: string, query: TmdbRequestQuery = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const url = buildUrl(pathname, query);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await waitForRequestSlot();
      const response = await fetch(url, { signal: combinedSignal(signal, REQUEST_TIMEOUT_MS) });
      const body = await parseJson(response);

      if (response.ok) {
        return body ?? {};
      }

      if (response.status === 404) {
        throw new HttpError(404, `TMDB resource not found for ${pathname}`);
      }

      if (attempt < MAX_RETRIES && RETRYABLE_STATUS_CODES.has(response.status)) {
        await sleep(parseRetryAfter(response, body) ?? backoffMs(attempt));
        continue;
      }

      throw new HttpError(response.status, `TMDB request failed for ${pathname}`);
    }

    throw new HttpError(502, `TMDB request failed for ${pathname}`);
  }
}
