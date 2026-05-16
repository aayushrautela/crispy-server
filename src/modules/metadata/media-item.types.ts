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

export type ResponsiveImageSet = {
  small: string | null;
  medium: string | null;
  large: string | null;
};

export type MediaImages = {
  poster: ResponsiveImageSet;
  backdrop: ResponsiveImageSet;
  logo: ResponsiveImageSet;
  still: ResponsiveImageSet;
};

export type Badge = {
  kind: string;
  label: string;
};

export type MediaItem = {
  mediaKey: string;
  mediaType: MediaItemType;
  title: string;
  originalTitle: string | null;
  subtitle: string | null;
  overview: string | null;
  images: MediaImages;
  releaseDate: string | null;
  releaseYear: number | null;
  rating: number | null;
  genres: string[];
  runtimeMinutes: number | null;
  status: string | null;
  maturityRating: string | null;
  certification: string | null;
  trailerUrl: string | null;
  trailerThumbnailUrl: string | null;
  posterColor: string | null;
  backdropColor: string | null;
  externalIds: MediaExternalIds;
  parent: MediaItemParent | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  episodeTitle: string | null;
  airDate: string | null;
  badges: Badge[];
};

export type MediaItemKind = 'Movie' | 'Series' | 'Season' | 'Episode' | 'Unknown';

export function mediaItemTypeFromKind(kind: MediaItemKind): MediaItemType {
  switch (kind) {
    case 'Movie': return 'movie';
    case 'Series': return 'show';
    case 'Season': return 'season';
    case 'Episode': return 'episode';
    default: return 'unknown';
  }
}

export function mediaItemKindFromType(type: MediaItemType): MediaItemKind {
  switch (type) {
    case 'movie': return 'Movie';
    case 'show': return 'Series';
    case 'season': return 'Season';
    case 'episode': return 'Episode';
    default: return 'Unknown';
  }
}

export type MediaImageTags = {
  primary: ResponsiveImageSet | null;
  backdrop: ResponsiveImageSet[];
  logo: ResponsiveImageSet | null;
  thumb: ResponsiveImageSet | null;
  screenshot: ResponsiveImageSet[];
};

export type ParentMediaImageTags = {
  primary: ResponsiveImageSet | null;
  backdrop: ResponsiveImageSet[];
  logo: ResponsiveImageSet | null;
  thumb: ResponsiveImageSet | null;
};

export type ProviderIds = {
  tmdb: string | null;
  imdb: string | null;
  tvdb: string | null;
};

export type UserItemDataDto = {
  itemId: string;
  isFavorite: boolean;
  played: boolean;
  playCount: number;
  playbackPositionSeconds: number | null;
  runtimeSeconds: number | null;
  playedPercentage: number | null;
  lastPlayedDate: string | null;
  rating: number | null;
  dismissedFromContinueWatching: boolean;
};

export type MediaItemDto = {
  id: string;
  mediaKey: string;
  type: MediaItemKind;
  name: string;
  originalTitle: string | null;
  overview: string | null;
  tagline: string | null;
  productionYear: number | null;
  premiereDate: string | null;
  communityRating: number | null;
  officialRating: string | null;
  certification: string | null;
  genres: string[];
  runTimeSeconds: number | null;
  status: string | null;
  providerIds: ProviderIds;
  imageTags: MediaImageTags;
  parentImageTags: ParentMediaImageTags | null;
  seriesId: string | null;
  seriesName: string | null;
  seasonId: string | null;
  seasonName: string | null;
  parentIndexNumber: number | null;
  indexNumber: number | null;
  absoluteIndexNumber: number | null;
  episodeTitle: string | null;
  airDate: string | null;
  trailerUrl: string | null;
  trailerThumbnailUrl: string | null;
  posterColor: string | null;
  backdropColor: string | null;
  userData: UserItemDataDto | null;
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
