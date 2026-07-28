import { logger } from '../../../config/logger.js';

const IMDB_GRAPHQL_URL = 'https://caching.graphql.imdb.com/';
const IMDB_VIDEO_PAGE_URL = 'https://www.imdb.com/video/';
const PLAYBACK_API_URL = 'https://www.imdb.com/ve/data/VIDEO_PLAYBACK_DATA';

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 500;

const GRAPHQL_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://www.imdb.com',
  'Referer': 'https://www.imdb.com/',
};

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
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
    const trailer = await this.lookupLatestTrailer(imdbId);
    if (!trailer) {
      return null;
    }

    const mp4Url = await this.extractMp4Url(trailer.videoId);
    if (!mp4Url) {
      return null;
    }

    return { url: mp4Url, thumbnailUrl: trailer.thumbnailUrl };
  }

  private async lookupLatestTrailer(imdbId: string): Promise<{ videoId: string; thumbnailUrl: string | null } | null> {
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
    const titleNode = asRecord(asRecord(payload?.data)?.title);
    const trailer = asRecord(titleNode?.latestTrailer);
    const videoId = asString(trailer?.id);
    if (!videoId) {
      if (asRecord(payload?.errors)) {
        logger.warn({ imdbId, errors: payload?.errors }, 'IMDb GraphQL returned errors');
      }
      return null;
    }

    const thumbnailUrl = asString(asRecord(trailer?.thumbnail)?.url);
    return { videoId, thumbnailUrl };
  }

  private async extractMp4Url(videoId: string): Promise<string | null> {
    const pageUrl = `${IMDB_VIDEO_PAGE_URL}${videoId}`;
    const response = await fetch(pageUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });

    if (!response.ok) {
      logger.warn({ status: response.status, videoId }, 'IMDB video page fetch failed');
      return null;
    }

    const html = await response.text();
    const url = extractMp4FromHtml(html);
    if (url) {
      return url;
    }

    return this.extractMp4FromPlaybackApi(videoId);
  }

  private async extractMp4FromPlaybackApi(videoId: string): Promise<string | null> {
    const key = Buffer.from(
      JSON.stringify({
        type: 'VIDEO_PLAYER',
        subType: 'FORCE_LEGACY',
        id: `vi${videoId}`,
      }),
    ).toString('base64');

    const response = await fetch(PLAYBACK_API_URL, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const payload = asRecord(await response.json().catch(() => null));
    const encodings = asArray(payload?.videoLegacyEncodings);
    for (const encoding of encodings) {
      const record = asRecord(encoding);
      if (!record) {
        continue;
      }
      const mimeType = asString(record.mimeType) ?? asString(record.videoMimeType);
      const url = asString(record.url);
      if (mimeType === 'MP4' && url) {
        return url;
      }
    }
    return null;
  }
}

function extractMp4FromHtml(html: string): string | null {
  const marker = '"playbackURLs":[';
  const startIndex = html.indexOf(marker);
  if (startIndex === -1) {
    return null;
  }

  const tail = html.slice(startIndex + marker.length);
  const bracketEnd = tail.indexOf('}]');
  if (bracketEnd === -1) {
    return null;
  }

  const slice = `[${tail.slice(0, bracketEnd + 2)}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }

  const entries = asArray(parsed);
  let fallback: string | null = null;
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const mimeType = asString(record.videoMimeType) ?? asString(record.mimeType);
    const url = asString(record.url);
    if (!url) {
      continue;
    }
    if (mimeType === 'MP4') {
      return url;
    }
    if (!fallback && (mimeType === 'M3U8' || mimeType === 'HLS')) {
      fallback = url;
    }
  }
  return fallback;
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
