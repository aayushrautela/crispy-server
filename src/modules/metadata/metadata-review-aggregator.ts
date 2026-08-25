import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../lib/errors.js';
import type { ProviderImportProvider } from '../integrations/provider-import.types.js';
import { ProviderTokenAccessService } from '../integrations/provider-token-access.service.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { extractExternalIds } from './metadata-builder.shared.js';
import type { MetadataReviewView } from './metadata-detail.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import { TraktClient } from './providers/trakt.client.js';
import type { TmdbReviewRecord, TmdbTitleRecord } from './providers/tmdb.types.js';

export const PRIMARY_REVIEW_THRESHOLD = 5;
export const REVIEW_LIMIT = 15;

type ReviewMediaType = 'movie' | 'show';

type ReviewExternalIds = {
  imdb: string | null;
  tmdb: number | null;
  tvdb: number | null;
};

type ReviewSource = {
  title: TmdbTitleRecord;
  mediaType: ReviewMediaType;
  externalIds: ReviewExternalIds;
  primaryReviews: MetadataReviewView[];
};

type ProfileTokenScope = {
  userId: string;
  profileId: string;
};

export class MetadataReviewAggregator {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly traktClient = new TraktClient(),
    private readonly providerTokenAccessService = new ProviderTokenAccessService(),
  ) {}

  async loadTitleReviews(
    client: DbClient,
    identity: MediaIdentity,
    language?: string | null,
    tokenScope?: ProfileTokenScope,
  ): Promise<MetadataReviewView[]> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
      throw new HttpError(400, 'Title reviews require a title itemId.');
    }

    const source = await this.loadPrimaryReviewSource(client, identity, language ?? null);
    return this.mergeWithTraktFallback(source, language ?? null, tokenScope);
  }

  async mergeTitleReviews(
    client: DbClient,
    title: TmdbTitleRecord,
    mediaType: ReviewMediaType,
    language?: string | null,
    tokenScope?: ProfileTokenScope,
  ): Promise<MetadataReviewView[]> {
    const primaryReviews = toReviewViews(await this.tmdbCacheService.getReviews(client, title.mediaType, title.tmdbId, REVIEW_LIMIT));
    return this.mergeWithTraktFallback({
      title,
      mediaType,
      externalIds: extractExternalIds(title),
      primaryReviews,
    }, language ?? null, tokenScope);
  }

  private async loadPrimaryReviewSource(
    client: DbClient,
    identity: MediaIdentity,
    language?: string | null,
  ): Promise<ReviewSource> {
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const title = assertPresent(source.tmdbTitle);
    const externalIds = extractExternalIds(title);

    const primaryReviews = toReviewViews(await this.tmdbCacheService.getReviews(client, title.mediaType, title.tmdbId, REVIEW_LIMIT));

    return {
      title,
      mediaType: identity.mediaType === 'movie' ? 'movie' : 'show',
      externalIds: {
        imdb: externalIds.imdb,
        tmdb: externalIds.tmdb,
        tvdb: externalIds.tvdb,
      },
      primaryReviews,
    };
  }

  private async mergeWithTraktFallback(
    source: ReviewSource,
    language: string | null,
    tokenScope?: ProfileTokenScope,
  ): Promise<MetadataReviewView[]> {
    const primaryReviews = source.primaryReviews.slice(0, REVIEW_LIMIT);
    if (primaryReviews.length >= PRIMARY_REVIEW_THRESHOLD || !this.traktClient.isConfigured()) {
      return primaryReviews;
    }

    const accessToken = tokenScope ? await this.resolveTraktAccessToken(tokenScope.userId, tokenScope.profileId) : undefined;
    const fallbackReviews = await this.traktClient.fetchTitleReviews(source.mediaType, source.externalIds, REVIEW_LIMIT, {
      accessToken,
    }).catch((error) => {
      logger.warn({
        err: error,
        userId: tokenScope?.userId ?? null,
        profileId: tokenScope?.profileId ?? null,
        tmdbId: source.title.tmdbId,
        mediaType: source.mediaType,
        externalIds: source.externalIds,
        language,
      }, 'failed to fetch trakt fallback reviews');
      return [];
    });

    return mergeReviews(primaryReviews, fallbackReviews);
  }

  private async resolveTraktAccessToken(userId: string, profileId: string): Promise<string | undefined> {
    try {
      const token = await this.providerTokenAccessService.getAccessTokenForAccountProfile(userId, profileId, 'trakt' satisfies ProviderImportProvider);
      return token.accessToken;
    } catch (error) {
      if (error instanceof HttpError && (error.statusCode === 404 || error.statusCode === 409 || error.statusCode === 502 || error.statusCode === 503)) {
        return undefined;
      }
      throw error;
    }
  }
}

function assertPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new HttpError(404, 'Metadata title not found.');
  }
  return value;
}

function toReviewViews(reviews: TmdbReviewRecord[]): MetadataReviewView[] {
  return reviews.map((review) => ({
    id: review.reviewKey,
    provider: review.source,
    author: review.author,
    username: review.authorUsername,
    content: review.content,
    createdAt: review.createdAt,
    updatedAt: null,
    url: review.url,
    rating: review.rating != null ? Number(review.rating) : null,
    avatarUrl: null,
  }));
}

export function mergeReviews(primary: MetadataReviewView[], fallback: MetadataReviewView[]): MetadataReviewView[] {
  const merged: MetadataReviewView[] = [];
  const seen = new Set<string>();

  for (const review of [...fallback, ...primary]) {
    const dedupeKey = `${review.author ?? ''}:${review.username ?? ''}:${review.content.trim().toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    merged.push(review);
    if (merged.length >= REVIEW_LIMIT) {
      break;
    }
  }

  return merged;
}
