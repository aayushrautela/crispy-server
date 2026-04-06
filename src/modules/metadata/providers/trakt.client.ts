import { env } from '../../../config/env.js';
import { HttpError } from '../../../lib/errors.js';
import type { MetadataExternalIds } from '../metadata-card.types.js';
import type { MetadataReviewView } from '../metadata-detail.types.js';

type FetchLike = typeof fetch;

type TraktTitleMediaType = 'movie' | 'show';

type ParsedTraktReview = MetadataReviewView & {
  isReview: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readArray(response: Response, pathname: string): Promise<Record<string, unknown>[]> {
  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload)) {
    throw new HttpError(502, `Trakt returned an invalid response for ${pathname}`);
  }

  return payload
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function normalizeTraktComment(entry: Record<string, unknown>): ParsedTraktReview | null {
  const comment = asRecord(entry.comment) ?? entry;
  const id = asInteger(comment.id) ?? asString(comment.id);
  const content = asString(comment.comment);
  if (!id || !content) {
    return null;
  }

  const user = asRecord(comment.user);
  const userIds = asRecord(user?.ids);
  const userStats = asRecord(comment.user_stats);
  const reviewId = String(id);

  return {
    id: `trakt:${reviewId}`,
    author: asString(user?.name),
    username: asString(user?.username) ?? asString(userIds?.slug),
    content,
    createdAt: asString(comment.created_at),
    updatedAt: asString(comment.updated_at),
    url: `https://trakt.tv/comments/${encodeURIComponent(reviewId)}`,
    rating: asNumber(userStats?.rating),
    avatarUrl: null,
    isReview: comment.review === true,
  };
}

export class TraktClient {
  constructor(private readonly fetcher: FetchLike = fetch) {}

  isConfigured(): boolean {
    return Boolean(env.traktImportClientId);
  }

  async fetchTitleReviews(
    mediaType: TraktTitleMediaType,
    externalIds: Pick<MetadataExternalIds, 'imdb' | 'tmdb' | 'tvdb'>,
    limit = 10,
  ): Promise<MetadataReviewView[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const traktId = await this.resolveTitleId(mediaType, externalIds);
    if (!traktId) {
      return [];
    }

    const pathname = mediaType === 'movie'
      ? `/movies/${encodeURIComponent(traktId)}/comments`
      : `/shows/${encodeURIComponent(traktId)}/comments`;
    const comments = await this.requestArray(pathname, { limit });
    const parsed = comments
      .map((entry) => normalizeTraktComment(entry))
      .filter((entry): entry is ParsedTraktReview => entry !== null);

    const prioritized = [
      ...parsed.filter((entry) => entry.isReview),
      ...parsed.filter((entry) => !entry.isReview),
    ];

    return prioritized.slice(0, limit).map(({ isReview: _isReview, ...review }) => review);
  }

  private async resolveTitleId(
    mediaType: TraktTitleMediaType,
    externalIds: Pick<MetadataExternalIds, 'imdb' | 'tmdb' | 'tvdb'>,
  ): Promise<string | null> {
    if (externalIds.imdb) {
      return externalIds.imdb;
    }

    if (externalIds.tmdb !== null) {
      return this.searchTitleId('tmdb', externalIds.tmdb, mediaType);
    }

    if (externalIds.tvdb !== null) {
      return this.searchTitleId('tvdb', externalIds.tvdb, mediaType);
    }

    return null;
  }

  private async searchTitleId(
    source: 'tmdb' | 'tvdb',
    id: number,
    mediaType: TraktTitleMediaType,
  ): Promise<string | null> {
    const results = await this.requestArray(`/search/${source}/${encodeURIComponent(String(id))}`, {
      type: mediaType,
      limit: 1,
    });
    const match = results[0];
    if (!match) {
      return null;
    }

    const title = asRecord(match[mediaType]);
    const ids = asRecord(title?.ids);
    const traktId = asInteger(ids?.trakt);
    if (traktId !== null) {
      return String(traktId);
    }

    return asString(ids?.slug);
  }

  private async requestArray(
    pathname: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<Record<string, unknown>[]> {
    if (!env.traktImportClientId) {
      throw new HttpError(503, 'Trakt is not configured.');
    }

    const url = new URL(`https://api.trakt.tv${pathname}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const response = await this.fetcher(url, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'trakt-api-key': env.traktImportClientId,
        'trakt-api-version': '2',
      },
    });

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new HttpError(response.status, `Trakt request failed for ${pathname}`);
    }

    return readArray(response, pathname);
  }
}
