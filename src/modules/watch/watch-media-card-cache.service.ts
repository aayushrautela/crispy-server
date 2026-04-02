import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity, SupportedProvider } from '../identity/media-key.js';
import type { MetadataTitleMediaType, RegularCardView } from '../metadata/metadata-card.types.js';
import { WatchMediaCardCacheRepository, type WatchMediaCardCacheRecord } from './watch-media-card-cache.repo.js';

export class WatchMediaCardCacheService {
  constructor(
    private readonly repository = new WatchMediaCardCacheRepository(),
  ) {}

  async upsertFromProjection(client: DbClient, identity: MediaIdentity, projection: {
    detailsTitleMediaType: MetadataTitleMediaType | null;
    playbackParentProvider: SupportedProvider | null;
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

    const titleProvider = resolveTitleProvider(identity, projection.playbackParentProvider);
    const titleProviderId = resolveTitleProviderId(identity, projection.playbackParentProviderId);
    const titleMediaType = resolveTitleMediaType(identity, projection.detailsTitleMediaType, titleProvider);
    if (!titleProvider || !titleProviderId || !titleMediaType) {
      return;
    }

    await this.repository.upsert(client, {
      mediaKey: identity.mediaKey,
      mediaType: identity.mediaType,
      titleProvider,
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
    provider: record.titleProvider,
    providerId: record.titleProviderId,
    title: record.title,
    posterUrl: record.posterUrl,
    releaseYear: record.releaseYear,
    rating: record.rating,
    genre: null,
    subtitle: record.subtitle,
  };
}

function resolveTitleProvider(identity: MediaIdentity, playbackParentProvider: SupportedProvider | null): SupportedProvider | null {
  if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return identity.provider ?? null;
  }

  return identity.parentProvider ?? playbackParentProvider ?? null;
}

function resolveTitleProviderId(identity: MediaIdentity, playbackParentProviderId: string | null): string | null {
  if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return identity.providerId ?? null;
  }

  return identity.parentProviderId ?? playbackParentProviderId;
}

function resolveTitleMediaType(
  identity: MediaIdentity,
  projectionMediaType: MetadataTitleMediaType | null,
  titleProvider: SupportedProvider | null,
): MetadataTitleMediaType | null {
  if (projectionMediaType === 'movie' || projectionMediaType === 'show' || projectionMediaType === 'anime') {
    return projectionMediaType;
  }

  if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return identity.mediaType;
  }

  if (identity.mediaType === 'episode' || identity.mediaType === 'season') {
    return titleProvider === 'kitsu' ? 'anime' : 'show';
  }

  return null;
}
