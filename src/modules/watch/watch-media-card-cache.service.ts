import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { showTmdbIdForIdentity } from '../identity/media-key.js';
import { buildResponsiveImageSet } from '../metadata/metadata-builder.shared.js';
import type { MetadataTitleMediaType, RegularCardView } from '../metadata/metadata-card.types.js';
import { WatchMediaCardCacheRepository, type WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';

export class WatchMediaCardCacheService {
  constructor(
    private readonly repository = new WatchMediaCardCacheRepository(),
  ) {}

  async upsertFromProjection(client: DbClient, identity: MediaIdentity, projection: {
    detailsTitleMediaType: MetadataTitleMediaType | null;
    playbackParentProvider: string | null;
    playbackParentProviderId: string | null;
    title: string | null;
    subtitle: string | null;
    posterUrl: string | null;
    backdropUrl: string | null;
    episodeStillUrl?: string | null;
    logoUrl: string | null;
    trailerUrl: string | null;
    trailerThumbnailUrl: string | null;
    posterColor: string | null;
    backdropColor: string | null;
    detailsReleaseYear: number | null;
    detailsRating: number | null;
    maturityRating: string | null;
    genres: string[];
  }, language?: string | null): Promise<void> {
    if (!projection.title) {
      return;
    }

    const titleProviderId = resolveTitleProviderId(identity, projection.playbackParentProviderId);
    const titleMediaType = resolveTitleMediaType(identity, projection.detailsTitleMediaType);
    if (!titleProviderId || !titleMediaType) {
      return;
    }

    await this.repository.upsert(client, {
      mediaKey: identity.mediaKey,
      mediaType: identity.mediaType,
      titleProvider: 'tmdb',
      titleProviderId,
      titleMediaType,
      title: projection.title,
      subtitle: projection.subtitle,
      posterUrl: projection.posterUrl,
      backdropUrl: projection.backdropUrl,
      stillUrl: projection.episodeStillUrl ?? null,
      logoUrl: projection.logoUrl,
      trailerUrl: projection.trailerUrl,
      trailerThumbnailUrl: projection.trailerThumbnailUrl,
      posterColor: projection.posterColor,
      backdropColor: projection.backdropColor,
      releaseYear: projection.detailsReleaseYear,
      rating: projection.detailsRating,
      maturityRating: projection.maturityRating,
      genres: projection.genres,
      language: language ?? undefined,
    });
  }

  async listRegularCards(client: DbClient, mediaKeys: string[], language?: string | null): Promise<Map<string, RegularCardView>> {
    const records = await this.repository.getByMediaKeys(client, mediaKeys, language ?? undefined);
    return new Map(
      Array.from(records.entries()).map(([mediaKey, record]) => [mediaKey, toRegularCard(record)]),
    );
  }

  async listCardCacheRecords(client: DbClient, mediaKeys: string[], language?: string | null): Promise<Map<string, WatchMediaCardCacheRecord>> {
    return this.repository.getByMediaKeys(client, mediaKeys, language ?? undefined);
  }
}

function toRegularCard(record: WatchMediaCardCacheRecord): RegularCardView {
  return {
    mediaType: record.titleMediaType,
    mediaKey: record.mediaKey,
    title: record.title,
    poster: buildResponsiveImageSet(record.posterUrl, {
      small: 'w342',
      medium: 'w500',
      large: 'w780',
    }),
    releaseYear: record.releaseYear,
    rating: record.rating,
    genre: record.genres[0] ?? null,
    subtitle: record.subtitle,
  };
}

function resolveTitleProviderId(identity: MediaIdentity, playbackParentProviderId: string | null): string | null {
  if (identity.mediaType === 'movie' || identity.mediaType === 'show') {
    return identity.tmdbId ? String(identity.tmdbId) : null;
  }

  const showTmdbId = showTmdbIdForIdentity(identity);
  return showTmdbId ? String(showTmdbId) : playbackParentProviderId;
}

function resolveTitleMediaType(
  identity: MediaIdentity,
  projectionMediaType: MetadataTitleMediaType | null,
): MetadataTitleMediaType | null {
  if (projectionMediaType === 'movie' || projectionMediaType === 'show') {
    return projectionMediaType;
  }

  if (identity.mediaType === 'movie' || identity.mediaType === 'show') {
    return identity.mediaType;
  }

  if (identity.mediaType === 'episode' || identity.mediaType === 'season') {
    return 'show';
  }

  return null;
}
