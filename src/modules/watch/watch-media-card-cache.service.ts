import type { DbClient } from '../../lib/db.js';
import { buildResponsiveImageSet } from '../metadata/metadata-builder.shared.js';
import type { MetadataTitleMediaType, RegularCardView } from '../metadata/metadata-card.types.js';
import type { SupportedProvider } from '../identity/media-key.js';
import { WatchMediaCardCacheRepository, type WatchMediaCardCacheRecord, type WatchMediaCardUpsert } from './watch-media-card-cache.repo.js';

export class WatchMediaCardCacheService {
  constructor(
    private readonly repository = new WatchMediaCardCacheRepository(),
  ) {}

  async upsertFromProjection(client: DbClient, params: {
    itemId: string;
    mediaType: 'movie' | 'show' | 'season' | 'episode';
    titleProvider: SupportedProvider;
    titleProviderId: string | null;
    titleMediaType: MetadataTitleMediaType | null;
  }, projection: {
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
    detailsOverview: string | null;
    detailsReleaseDate: string | null;
    detailsStatus: string | null;
    detailsRuntimeMinutes: number | null;
    detailsRating: number | null;
    episodeTitle: string | null;
    episodeAirDate: string | null;
    episodeRuntimeMinutes: number | null;
    maturityRating: string | null;
    genres: string[];
  }, language?: string | null): Promise<void> {
    if (!projection.title) {
      return;
    }

    const titleProviderId = params.titleProviderId ?? null;
    const titleMediaType = resolveTitleMediaType(params.mediaType, params.titleMediaType);
    if (!titleProviderId || !titleMediaType) {
      return;
    }

    await this.repository.upsert(client, {
      itemId: params.itemId,
      mediaType: params.mediaType,
      titleProvider: params.titleProvider,
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
      overview: projection.detailsOverview,
      runtimeMinutes: projection.episodeRuntimeMinutes ?? projection.detailsRuntimeMinutes,
      releaseDate: projection.detailsReleaseDate,
      status: projection.detailsStatus,
      episodeTitle: projection.episodeTitle,
      episodeAirDate: projection.episodeAirDate,
    });
  }

  async listRegularCards(client: DbClient, itemIds: string[], language?: string | null): Promise<Map<string, RegularCardView>> {
    const records = await this.repository.getByItemIds(client, itemIds, language ?? undefined);
    return new Map(
      Array.from(records.entries()).map(([id, record]) => [id, toRegularCard(record)]),
    );
  }

  async upsertManyFromProjections(client: DbClient, entries: Array<{
    params: {
      itemId: string;
      mediaType: 'movie' | 'show' | 'season' | 'episode';
      titleProvider: SupportedProvider;
      titleProviderId: string | null;
      titleMediaType: MetadataTitleMediaType | null;
    };
    projection: Parameters<WatchMediaCardCacheService['upsertFromProjection']>[2];
  }>, language?: string | null): Promise<void> {
    const upserts: WatchMediaCardUpsert[] = [];
    for (const { params, projection } of entries) {
      if (!projection.title) {
        continue;
      }
      const titleProviderId = params.titleProviderId ?? null;
      const titleMediaType = resolveTitleMediaType(params.mediaType, params.titleMediaType);
      if (!titleProviderId || !titleMediaType) {
        continue;
      }
      upserts.push({
        itemId: params.itemId,
        mediaType: params.mediaType,
        titleProvider: params.titleProvider,
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
        overview: projection.detailsOverview,
        runtimeMinutes: projection.episodeRuntimeMinutes ?? projection.detailsRuntimeMinutes,
        releaseDate: projection.detailsReleaseDate,
        status: projection.detailsStatus,
        episodeTitle: projection.episodeTitle,
        episodeAirDate: projection.episodeAirDate,
      });
    }

    await this.repository.upsertMany(client, upserts);
  }

  async listCardCacheRecords(client: DbClient, itemIds: string[], language?: string | null): Promise<Map<string, WatchMediaCardCacheRecord>> {
    return this.repository.getByItemIds(client, itemIds, language ?? undefined);
  }
}

function toRegularCard(record: WatchMediaCardCacheRecord): RegularCardView {
  return {
    mediaType: record.titleMediaType,
    itemId: record.itemId,
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

function resolveTitleMediaType(mediaType: string, projectionMediaType: MetadataTitleMediaType | null): MetadataTitleMediaType | null {
  if (projectionMediaType === 'movie' || projectionMediaType === 'show') return projectionMediaType;
  if (mediaType === 'movie' || mediaType === 'show') return mediaType;
  if (mediaType === 'episode' || mediaType === 'season') return 'show';
  return null;
}
