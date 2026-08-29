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

const TRAILER_CONTENT_TYPE = 'amzn1.imdb.video.contenttype.trailer';
const THEATRICAL_KEYWORDS = ['theatrical', 'full', 'final'];
const TEASER_KEYWORD = 'teaser';

export type ImdbTrailerResolution = {
  url: string;
  thumbnailUrl: string | null;
};

type CacheEntry = {
  value: ImdbTrailerResolution | null;
  expiresAt: number;
};

const VIDEO_STRIP_QUERY = `
query CrispyTrailerStrip($id: ID!, $first: Int!, $after: ID, $filter: VideosQueryFilter, $sort: VideoSort) {
  title(id: $id) {
    videoStrip(first: $first, after: $after, filter: $filter, sort: $sort) {
      pageInfo {
        endCursor
        hasNextPage
      }
      total
      edges {
        node {
          id
          contentType { id }
          name { value }
          runtime { value }
          thumbnail { url }
          primaryTitle {
            series {
              displayableEpisodeNumber {
                displayableSeason { season }
              }
              series {
                titleText { text }
              }
            }
          }
          playbackURLs { url mimeType }
        }
      }
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
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

type VideoNode = {
  id: string;
  contentType: { id: string };
  name: { value: string };
  runtime: { value: number };
  thumbnail: { url: string } | null;
  primaryTitle: {
    series: {
      displayableEpisodeNumber: {
        displayableSeason: { season: number };
      };
      series: {
        titleText: { text: string };
      };
    };
  } | null;
  playbackURLs: Array<{ url: string; mimeType: string }>;
};

function parseVideoNode(node: Record<string, unknown>): VideoNode | null {
  const contentType = asRecord(node.contentType);
  const name = asRecord(node.name);
  const runtime = asRecord(node.runtime);
  const thumbnail = asRecord(node.thumbnail);
  const primaryTitle = asRecord(node.primaryTitle);

  if (!contentType || !name || !runtime) {
    return null;
  }

  return {
    id: asString(node.id) ?? '',
    contentType: { id: asString(contentType.id) ?? '' },
    name: { value: asString(name.value) ?? '' },
    runtime: { value: asNumber(runtime.value) ?? 0 },
    thumbnail: thumbnail ? { url: asString(thumbnail.url) ?? '' } : null,
    primaryTitle: primaryTitle && asRecord(primaryTitle.series) ? {
      series: {
        displayableEpisodeNumber: {
          displayableSeason: {
            season: asNumber(asRecord(asRecord(asRecord(primaryTitle.series)?.displayableEpisodeNumber)?.displayableSeason)?.season) ?? 0,
          },
        },
        series: {
          titleText: {
            text: asString(asRecord(asRecord(asRecord(primaryTitle.series)?.series)?.titleText)?.text) ?? '',
          },
        },
      },
    } : null,
    playbackURLs: asArray(node.playbackURLs)
      .map((entry) => {
        const record = asRecord(entry);
        if (!record) return null;
        const url = asString(record.url);
        const mimeType = asString(record.mimeType);
        return url && mimeType ? { url, mimeType } : null;
      })
      .filter((entry): entry is { url: string; mimeType: string } => entry !== null),
  };
}

function getSeasonNumber(video: VideoNode): number | null {
  const season = asNumber(video.primaryTitle?.series.displayableEpisodeNumber.displayableSeason.season);
  return season && season > 0 ? season : null;
}

function scoreTrailer(video: VideoNode): number {
  const titleLower = video.name.value.toLowerCase();
  let score = 0;

  if (THEATRICAL_KEYWORDS.some((keyword) => titleLower.includes(keyword))) {
    score += 100;
  }
  if (!titleLower.includes(TEASER_KEYWORD)) {
    score += 50;
  }
  score += video.runtime.value;

  return score;
}

function pickBestTrailer(videos: VideoNode[], targetSeason: number | null): VideoNode | null {
  const trailers = videos.filter((v) => v.contentType.id === TRAILER_CONTENT_TYPE);
  if (trailers.length === 0) {
    return null;
  }

  let candidates = trailers;
  if (targetSeason !== null) {
    const seasonMatches = trailers.filter((v) => getSeasonNumber(v) === targetSeason);
    if (seasonMatches.length > 0) {
      candidates = seasonMatches;
    }
  }

  return candidates.reduce((best, current) => scoreTrailer(current) > scoreTrailer(best) ? current : best);
}

function pickFirstMp4(playbackUrls: Array<{ url: string; mimeType: string }>): string | null {
  for (const entry of playbackUrls) {
    if (entry.mimeType.includes('mp4')) {
      return entry.url;
    }
  }
  return null;
}

export class ImdbTrailerService {
  private readonly cache = new LruCache();

  async resolveTrailer(imdbId: string, seasonNumber?: number | null): Promise<ImdbTrailerResolution | null> {
    const normalized = normalizeImdbId(imdbId);
    if (!normalized) {
      return null;
    }

    const cacheKey = seasonNumber ? `${normalized}:s${seasonNumber}` : normalized;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached.value;
    }

    let value: ImdbTrailerResolution | null = null;
    try {
      value = await this.resolveTrailerUncached(normalized, seasonNumber ?? null);
    } catch (error) {
      logger.warn({ err: error, imdbId: normalized, seasonNumber }, 'IMDb trailer resolution failed');
      value = null;
    }

    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return value;
  }

  private async resolveTrailerUncached(imdbId: string, seasonNumber: number | null): Promise<ImdbTrailerResolution | null> {
    const videos = await this.fetchAllTrailers(imdbId);
    if (videos.length === 0) {
      return null;
    }

    const bestTrailer = pickBestTrailer(videos, seasonNumber);
    if (!bestTrailer) {
      return null;
    }

    const mp4Url = pickFirstMp4(bestTrailer.playbackURLs);
    if (!mp4Url) {
      return null;
    }

    return {
      url: mp4Url,
      thumbnailUrl: bestTrailer.thumbnail?.url ?? null,
    };
  }

  private async fetchAllTrailers(imdbId: string): Promise<VideoNode[]> {
    const videos: VideoNode[] = [];
    let after: string | null = null;
    let hasNextPage = true;
    const maxPages = 5;
    let pagesFetched = 0;

    while (hasNextPage && pagesFetched < maxPages) {
      const response = await this.fetchPage(imdbId, after);
      if (!response) {
        break;
      }

      for (const edge of response.edges) {
        const node = parseVideoNode(asRecord(edge) ?? {});
        if (node) {
          videos.push(node);
        }
      }

      hasNextPage = response.pageInfo.hasNextPage;
      after = response.pageInfo.endCursor;
      pagesFetched += 1;
    }

    return videos;
  }

  private async fetchPage(imdbId: string, after: string | null): Promise<{
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: unknown[];
  } | null> {
    const variables: Record<string, unknown> = {
      id: imdbId,
      first: 50,
      filter: {
        maturityLevel: 'INCLUDE_MATURE',
        nameConstraints: {},
        titleConstraints: {},
        types: ['TRAILER'],
      },
      sort: { by: 'DATE', order: 'DESC' },
    };

    if (after) {
      variables.after = after;
    }

    const response = await fetch(IMDB_GRAPHQL_URL, {
      method: 'POST',
      headers: GRAPHQL_HEADERS,
      body: JSON.stringify({ query: VIDEO_STRIP_QUERY, variables }),
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
    const videoStrip = asRecord(titleNode?.videoStrip);
    if (!videoStrip) {
      return null;
    }

    const pageInfo = asRecord(videoStrip.pageInfo);
    return {
      pageInfo: {
        hasNextPage: pageInfo?.hasNextPage === true,
        endCursor: asString(pageInfo?.endCursor) ?? null,
      },
      edges: asArray(videoStrip.edges).map((edge) => asRecord(edge)?.node).filter(Boolean),
    };
  }
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
