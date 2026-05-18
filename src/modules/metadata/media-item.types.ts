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

export type BaseItemKind = 'Movie' | 'Series' | 'Season' | 'Episode' | 'Unknown';

export function mediaItemTypeFromKind(kind: BaseItemKind): MediaItemType {
  switch (kind) {
    case 'Movie': return 'movie';
    case 'Series': return 'show';
    case 'Season': return 'season';
    case 'Episode': return 'episode';
    default: return 'unknown';
  }
}

export function mediaItemKindFromType(type: MediaItemType): BaseItemKind {
  switch (type) {
    case 'movie': return 'Movie';
    case 'show': return 'Series';
    case 'season': return 'Season';
    case 'episode': return 'Episode';
    default: return 'Unknown';
  }
}

export type BaseItemImageTags = {
  Primary: ResponsiveImageSet | null;
  Backdrop: ResponsiveImageSet[];
  Logo: ResponsiveImageSet | null;
  Thumb: ResponsiveImageSet | null;
  Screenshot: ResponsiveImageSet[];
};

export type ParentBaseItemImageTags = {
  Primary: ResponsiveImageSet | null;
  Backdrop: ResponsiveImageSet[];
  Logo: ResponsiveImageSet | null;
  Thumb: ResponsiveImageSet | null;
};

export type ProviderIdsDto = {
  Tmdb: string | null;
  Imdb: string | null;
  Tvdb: string | null;
};

export type RemoteTrailerDto = {
  Name: string | null;
  Url: string;
  ThumbnailUrl: string | null;
};

export type UserItemDataDto = {
  ItemId: string;
  IsFavorite: boolean;
  Played: boolean;
  PlayCount: number;
  PlaybackPositionTicks: number | null;
  RuntimeTicks: number | null;
  PlayedPercentage: number | null;
  LastPlayedDate: string | null;
  Rating: number | null;
  DismissedFromContinueWatching: boolean;
};

export type BaseItemDto = {
  Id: string;
  Type: BaseItemKind;
  Name: string;
  OriginalTitle: string | null;
  Overview: string | null;
  Taglines: string[];
  ProductionYear: number | null;
  PremiereDate: string | null;
  CommunityRating: number | null;
  OfficialRating: string | null;
  Certification: string | null;
  Genres: string[];
  RunTimeTicks: number | null;
  Status: string | null;
  ProviderIds: ProviderIdsDto;
  ImageTags: BaseItemImageTags;
  ParentImageTags: ParentBaseItemImageTags | null;
  SeriesId: string | null;
  SeriesName: string | null;
  SeasonId: string | null;
  SeasonName: string | null;
  ParentIndexNumber: number | null;
  IndexNumber: number | null;
  AbsoluteIndexNumber: number | null;
  EpisodeTitle: string | null;
  AirDate: string | null;
  RemoteTrailers: RemoteTrailerDto[];
  PosterColor: string | null;
  BackdropColor: string | null;
  UserData: UserItemDataDto | null;
};

export type BaseItemDtoQueryResult = {
  Items: BaseItemDto[];
  StartIndex: number;
  TotalRecordCount: number;
  NextCursor: string | null;
  HasMore: boolean;
};
