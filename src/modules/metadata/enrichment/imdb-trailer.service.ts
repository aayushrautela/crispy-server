import { logger } from '../../../config/logger.js';

const IMDB_GRAPHQL_URL = 'https://caching.graphql.imdb.com/';

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 500;

const GRAPHQL_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://www.imdb.com',
  'Referer': 'https://www.imdb.com/',
};

export type ImdbTrailerResolution = {
  url: string;
  thumbnailUrl: string | null;
};

type CacheEntry = {
  value: ImdbTrailerResolution | null;
  expiresAt: number;
};

const LATEST_TRAILER_QUERY = `
query CrispyLatestTrailer($id: ID!) {
  title(id: $id) {
    latestTrailer {
      id
      runtime { value }
      thumbnail { url }
      name { value }
      playbackURLs { url mimeType }
    }
  }
}`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

class LruCache {
  private entries = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, value: CacheEntry): void {
    if (this.entries.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, value);
  }
}

export class ImdbTrailerService {
  private readonly cache = new LruCache();

  async resolveTrailer(imdbId: string): Promise<ImdbTrailerResolution | null> {
    const normalized = normalizeImdbId(imdbId);
    if (!normalized) {
      return null;
    }

    const cached = this.cache.get(normalized);
    if (cached) {
      return cached.value;
    }

    let value: ImdbTrailerResolution | null = null;
    try {
      value = await this.resolveTrailerUncached(normalized);
    } catch (error) {
      logger.warn({ err: error, imdbId: normalized }, 'IMDb trailer resolution failed');
      value = null;
    }

    this.cache.set(normalized, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return value;
  }

  private async resolveTrailerUncached(imdbId: string): Promise<ImdbTrailerResolution | null> {
    const body = {
      query: LATEST_TRAILER_QUERY,
      variables: { id: imdbId },
    };

    const response = await fetch(IMDB_GRAPHQL_URL, {
      method: 'POST',
      headers: GRAPHQL_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, imdbId }, 'IMDb GraphQL request failed');
      return null;
    }

    const payload = asRecord(await response.json().catch(() => null));
    if (asArray(payload?.errors).length > 0) {
      logger.warn({ imdbId, errors: payload?.errors }, 'IMDb GraphQL returned errors');
      return null;
    }

    const titleNode = asRecord(asRecord(payload?.data)?.title);
    const trailer = asRecord(titleNode?.latestTrailer);
    const thumbnailUrl = asString(asRecord(trailer?.thumbnail)?.url);

    const playbackUrls = asArray(trailer?.playbackURLs);
    const mp4Url = pickFirstMp4(playbackUrls);
    if (!mp4Url) {
      return null;
    }

    return { url: mp4Url, thumbnailUrl };
  }
}

function pickFirstMp4(playbackUrls: unknown[]): string | null {
  for (const entry of playbackUrls) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const mimeType = asString(record.mimeType);
    const url = asString(record.url);
    if (url && mimeType && mimeType.includes('mp4')) {
      return url;
    }
  }
  return null;
}

function normalizeImdbId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^tt\d+$/.test(trimmed) ? trimmed : null;
}

const imdbTrailerService = new ImdbTrailerService();

export { imdbTrailerService };
