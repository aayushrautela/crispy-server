import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { showTmdbIdForIdentity } from '../identity/media-key.js';
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
    detailsReleaseYear: number | null;
    detailsRating: number | null;
  }): Promise<void> {
    if (!projection.title || !projection.posterUrl) {
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
      releaseYear: projection.detailsReleaseYear,
      rating: projection.detailsRating,
    });
  }

  async listRegularCards(client: DbClient, mediaKeys: string[]): Promise<Map<string, RegularCardView>> {
    const records = await this.repository.getByMediaKeys(client, mediaKeys);
    return new Map(
      Array.from(records.entries()).map(([mediaKey, record]) => [mediaKey, toRegularCard(record)]),
    );
  }
}

function toRegularCard(record: WatchMediaCardCacheRecord): RegularCardView {
  return {
    mediaType: record.titleMediaType,
    mediaKey: record.mediaKey,
    title: record.title,
    posterUrl: record.posterUrl,
    releaseYear: record.releaseYear,
    rating: record.rating,
    genre: null,
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
