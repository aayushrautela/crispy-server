import type {
  ClientImages,
  ClientMediaCard,
  ClientMediaType,
  ClientParentRef,
  ClientProgress,
  ClientProviderIds,
} from '../recommendations/client-home.types.js';
import type { MetadataCardView, MetadataExternalIds } from './metadata-card.types.js';

export type ToClientMediaCardOptions = {
  progress?: ClientProgress | null;
  itemId?: string;
  overviewOverride?: string;
  seriesTitle?: string;
};

export function toClientMediaCard(
  view: MetadataCardView,
  opts: ToClientMediaCardOptions = {},
): ClientMediaCard {
  const progress = opts.progress ?? null;
  const itemId = opts.itemId ?? view.itemId;

  const parent: ClientParentRef | null =
    view.seriesItemId || view.seasonItemId || view.seasonNumber !== null || view.episodeNumber !== null
      ? {
          seriesItemId: view.seriesItemId ?? undefined,
          seriesTitle: opts.seriesTitle,
          seasonItemId: view.seasonItemId ?? undefined,
          seasonNumber: view.seasonNumber,
          episodeNumber: view.episodeNumber,
        }
      : null;

  const images: ClientImages = {
    poster: view.images.poster,
    backdrop: view.images.backdrop,
    logo: view.images.logo,
    still: view.images.still,
  };

  return {
    itemId,
    mediaType: toClientMediaType(view.mediaType),
    title: view.title ?? '',
    overview: opts.overviewOverride ?? view.overview ?? view.tagline ?? view.summary,
    year: view.releaseYear,
    releaseDate: view.releaseDate,
    rating: view.rating,
    maturityRating: view.maturityRating,
    genres: view.genres,
    runtimeSeconds: typeof view.runtimeMinutes === 'number' ? view.runtimeMinutes * 60 : null,
    images,
    trailerUrl: view.trailerUrl,
    progress,
    parent,
    providerIds: toProviderIds(view.externalIds),
  };
}

function toClientMediaType(mediaType: string): ClientMediaType {
  if (mediaType === 'show') return 'tv';
  if (mediaType === 'movie' || mediaType === 'season' || mediaType === 'episode') return mediaType;
  return 'movie';
}

function toProviderIds(externalIds: MetadataExternalIds | null | undefined): ClientProviderIds | null {
  if (!externalIds) return null;
  const tmdb = externalIds.tmdb != null ? String(externalIds.tmdb) : null;
  const tvdb = externalIds.tvdb != null ? String(externalIds.tvdb) : null;
  const imdb = externalIds.imdb ?? null;
  if (!tmdb && !tvdb && !imdb) return null;
  return { tmdb, tvdb, imdb };
}
