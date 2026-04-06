import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { ProviderImportProvider } from '../integrations/provider-import.types.js';
import { ProviderTokenAccessService } from '../integrations/provider-token-access.service.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { extractExternalIds, extractReviews } from './metadata-builder.shared.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { resolveTitleRouteIdentity } from './metadata-detail.service.js';
import type { MetadataReviewView, MetadataTitleReviewsResponse } from './metadata-detail.types.js';
import { TraktClient } from './providers/trakt.client.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';

const PRIMARY_REVIEW_THRESHOLD = 3;
const REVIEW_LIMIT = 10;

export class MetadataReviewsService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
    private readonly traktClient = new TraktClient(),
    private readonly providerTokenAccessService = new ProviderTokenAccessService(),
  ) {}

  async getTitleReviews(userId: string, profileId: string, mediaKey: string, language?: string | null): Promise<MetadataTitleReviewsResponse> {
    return withDbClient(async (client) => {
      const identity = await resolveTitleRouteIdentity(client, this.contentIdentityService, mediaKey);
      const reviews = await this.loadTitleReviews(client, userId, profileId, identity, language ?? null);
      return { reviews };
    });
  }

  async loadTitleReviews(
    client: DbClient,
    userId: string,
    profileId: string,
    identity: MediaIdentity,
    language?: string | null,
  ): Promise<MetadataReviewView[]> {
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
      throw new HttpError(400, 'Title reviews require a title mediaKey.');
    }

    const source = await this.loadPrimaryReviewSource(client, identity, language ?? null);
    const primaryReviews = source.primaryReviews.slice(0, REVIEW_LIMIT);
    if (primaryReviews.length >= PRIMARY_REVIEW_THRESHOLD || !this.traktClient.isConfigured()) {
      return primaryReviews;
    }

    const accessToken = await this.resolveTraktAccessToken(userId, profileId);
    const traktMediaType = source.mediaType === 'movie' ? 'movie' : 'show';
    const fallbackReviews = await this.traktClient.fetchTitleReviews(traktMediaType, source.externalIds, REVIEW_LIMIT, {
      accessToken,
    }).catch(() => []);

    return mergeReviews(primaryReviews, fallbackReviews);
  }

  private async loadPrimaryReviewSource(
    client: DbClient,
    identity: MediaIdentity,
    language?: string | null,
  ): Promise<{
    mediaType: 'movie' | 'show' | 'anime';
    externalIds: { imdb: string | null; tmdb: number | null; tvdb: number | null };
    primaryReviews: MetadataReviewView[];
  }> {
    const providerIdentity = normalizeProviderTitleIdentity(identity);
    if (providerIdentity) {
      const providerContext = await this.providerMetadataService.loadIdentityContext(client, providerIdentity, language ?? null);
      const title = providerContext?.title;
      if (!title) {
        throw new HttpError(404, 'Metadata title not found.');
      }

      return {
        mediaType: title.mediaType,
        externalIds: {
          imdb: title.externalIds.imdb,
          tmdb: title.externalIds.tmdb,
          tvdb: title.externalIds.tvdb,
        },
        primaryReviews: providerContext?.reviews ?? [],
      };
    }

    const tmdbType = identity.mediaType === 'movie' ? 'movie' : 'tv';
    const tmdbId = assertPresent(identity.tmdbId, 'Metadata title not found.');
    const title = await this.tmdbCacheService.getTitle(client, tmdbType, tmdbId);

    return {
      mediaType: identity.mediaType === 'movie' ? 'movie' : 'show',
      externalIds: extractExternalIds(title),
      primaryReviews: extractReviews(title),
    };
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

  for (const review of [...primary, ...fallback]) {
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

function normalizeProviderTitleIdentity(identity: MediaIdentity): MediaIdentity | null {
  if (identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
    return null;
  }

  return identity.provider === 'tvdb' || identity.provider === 'kitsu'
    ? identity
    : null;
}
