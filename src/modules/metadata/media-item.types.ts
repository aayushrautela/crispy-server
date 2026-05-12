export type MediaItemType = 'movie' | 'show' | 'season' | 'episode' | 'unknown';

export type MediaExternalIds = {
  tmdb: number | null;
  imdb: string | null;
  tvdb: number | null;
};

export type MediaItemParent = {
  mediaKey: string;
  mediaType: MediaItemType;
  title: string;
};

export type MediaItem = {
  mediaKey: string;
  mediaType: MediaItemType;
  title: string;
  originalTitle: string | null;
  subtitle: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  stillUrl: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
  rating: number | null;
  genres: string[];
  runtimeMinutes: number | null;
  status: string | null;
  certification: string | null;
  externalIds: MediaExternalIds;
  parent: MediaItemParent | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  episodeTitle: string | null;
  airDate: string | null;
};

export type MobileSurfaceKind =
  | 'continue_watching'
  | 'recommendation'
  | 'watch_history'
  | 'watchlist'
  | 'rating'
  | 'watch_state'
  | 'calendar_item'
  | 'featured'
  | 'search_result'
  | 'metadata_detail';

export type MediaPresentationHint = {
  preferredSize: 'poster' | 'wide' | 'hero' | 'compact' | null;
  sectionId: string | null;
  sectionTitle: string | null;
};

export type MobileSurfaceItem<TContext extends Record<string, unknown>> = {
  kind: MobileSurfaceKind;
  media: MediaItem;
  context: TContext;
  presentation: MediaPresentationHint | null;
};
