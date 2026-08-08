import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { ProviderImportProvider } from '../integrations/provider-import.types.js';
import { ProviderTokenAccessService } from '../integrations/provider-token-access.service.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { extractExternalIds, extractReviewsFromRaw } from './metadata-builder.shared.js';
import type { MetadataReviewView } from './metadata-detail.types.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import { TraktClient } from './providers/trakt.client.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';

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
    private readonly traktClient = new TraktClient(),
    private readonly providerTokenAccessService = new ProviderTokenAccessService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
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
    title: TmdbTitleRecord,
    mediaType: ReviewMediaType,
    primaryReviews: MetadataReviewView[],
    language?: string | null,
    tokenScope?: ProfileTokenScope,
  ): Promise<MetadataReviewView[]> {
    const externalIds = extractExternalIds(title);
    return this.mergeWithTraktFallback({
      title,
      mediaType,
      externalIds: {
        imdb: externalIds.imdb,
        tmdb: externalIds.tmdb,
        tvdb: externalIds.tvdb,
      },
      primaryReviews,
    }, language ?? null, tokenScope);
  }

  private async loadPrimaryReviewSource(
    client: DbClient,
    identity: MediaIdentity,
    language?: string | null,
  ): Promise<ReviewSource> {
    const source = await this.titleSourceService.loadTitleSource(client, identity, language ?? null);
    const title = assertPresent(source.tmdbTitle, 'Metadata title not found.');
    const externalIds = extractExternalIds(title);

    const extrasRaw = await this.tmdbCacheService.fetchTitleExtrasPayload(
      client,
      identity.mediaType === 'movie' ? 'movie' : 'tv',
      title.tmdbId,
      language ?? null,
    );

    return {
      title,
      mediaType: identity.mediaType === 'movie' ? 'movie' : 'show',
      externalIds: {
        imdb: externalIds.imdb,
        tmdb: externalIds.tmdb,
        tvdb: externalIds.tvdb,
      },
      primaryReviews: extrasRaw ? extractReviewsFromRaw(extrasRaw).slice(0, REVIEW_LIMIT) : [],
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
