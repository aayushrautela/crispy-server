import type { SupportedProvider } from '../identity/media-key.js';
import type { MediaItem, MediaPresentationHint } from './media-item.types.js';
import type {
  MetadataExternalIds,
  MetadataEpisodePreview,
  MetadataImages,
  MetadataParentMediaType,
  MetadataTitleMediaType,
  MetadataViewMediaType,
  ResponsiveImageSet,
} from './metadata-card.types.js';

export type MetadataView = {
  mediaType: MetadataViewMediaType;
  kind: 'title' | 'episode';
  mediaKey: string;
  parentMediaType: MetadataParentMediaType | null;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  title: string | null;
  subtitle: string | null;
  summary: string | null;
  overview: string | null;
  artwork: import('./metadata-card.types.js').MetadataArtwork;
  images: MetadataImages;
  releaseDate: string | null;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  rating: number | null;
  maturityRating: string | null;
  certification: string | null;
  trailerUrl: string | null;
  trailerThumbnailUrl: string | null;
  posterColor: string | null;
  backdropColor: string | null;
  status: string | null;
  genres: string[];
  externalIds: MetadataExternalIds;
  seasonCount: number | null;
  episodeCount: number | null;
  nextEpisode: MetadataEpisodePreview | null;
};

export type MetadataSeasonView = {
  mediaKey: string;
  parentMediaType: MetadataParentMediaType;
  showTmdbId: number | null;
  seasonNumber: number;
  title: string | null;
  summary: string | null;
  airDate: string | null;
  episodeCount: number | null;
  images: {
    poster: ResponsiveImageSet;
  };
};

export type MetadataEpisodeView = MetadataEpisodePreview & {
  showTitle: string | null;
  showExternalIds: MetadataExternalIds;
};

export type MetadataVideoView = {
  id: string;
  key: string;
  name: string | null;
  site: string | null;
  type: string | null;
  official: boolean;
  publishedAt: string | null;
  url: string | null;
  thumbnailUrl: string | null;
};

export type MetadataPersonRefView = {
  id: string;
  provider: SupportedProvider;
  providerId: string;
  tmdbPersonId: number | null;
  name: string;
  role: string | null;
  department: string | null;
  profileUrl: string | null;
};

export type MetadataReviewSource = SupportedProvider | 'trakt';

export type MetadataReviewView = {
  id: string;
  provider: MetadataReviewSource;
  author: string | null;
  username: string | null;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
  rating: number | null;
  avatarUrl: string | null;
};

export type MetadataCompanyView = {
  id: number | string;
  provider: SupportedProvider;
  providerId: string;
  name: string;
  logo: ResponsiveImageSet;
  originCountry: string | null;
};

export type MetadataRelatedItem = {
  kind: 'metadata_detail';
  mediaItem: MediaItem;
  context: Record<string, unknown>;
  presentation: MediaPresentationHint | null;
};

export type MetadataCollectionView = {
  id: number | string;
  provider: SupportedProvider;
  providerId: string;
  name: string;
  poster: ResponsiveImageSet;
  backdrop: ResponsiveImageSet;
  parts: MetadataRelatedItem[];
};

export type MetadataProductionInfoView = {
  originalLanguage: string | null;
  originCountries: string[];
  spokenLanguages: string[];
  productionCountries: string[];
  companies: MetadataCompanyView[];
  networks: MetadataCompanyView[];
};

export type MetadataTitleDetail = {
  item: MetadataView;
  nextEpisode: MetadataEpisodeView | null;
  videos: MetadataVideoView[];
  cast: MetadataPersonRefView[];
  directors: MetadataPersonRefView[];
  creators: MetadataPersonRefView[];
  production: MetadataProductionInfoView;
  collection: MetadataCollectionView | null;
  similar: MetadataRelatedItem[];
};

export type MetadataTitleReviewsResponse = {
  reviews: MetadataReviewView[];
};

export type MetadataTitleRatingsResponse = {
  ratings: {
    imdb: number | null;
    tmdb: number | null;
    trakt: number | null;
    metacritic: number | null;
    rottenTomatoes: number | null;
    audience: number | null;
    letterboxd: number | null;
    rogerEbert: number | null;
  };
};

export type MetadataTitleExtras = {
  seasons: MetadataSeasonView[];
  episodes: MetadataEpisodeView[];
  reviews: MetadataReviewView[];
  similar: MetadataRelatedItem[];
  collection: MetadataCollectionView | null;
};

export type MetadataSeasonDetail = {
  show: MetadataView;
  season: MetadataSeasonView;
  episodes: MetadataEpisodeView[];
};

export type MetadataEpisodeListResponse = {
  show: MetadataView;
  requestedSeasonNumber: number | null;
  effectiveSeasonNumber: number;
  includedSeasonNumbers: number[];
  episodes: MetadataEpisodeView[];
};

export type MetadataNextEpisodeResponse = {
  show: MetadataView;
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  item: MetadataEpisodeView | null;
};

export type PlaybackResolveResponse = {
  item: MetadataView;
  show: MetadataView | null;
  season: MetadataSeasonView | null;
};

export type MetadataPersonKnownForItem = {
  mediaType: MetadataTitleMediaType;
  mediaKey: string;
  provider: SupportedProvider;
  providerId: string;
  tmdbId: number;
  title: string;
  poster: ResponsiveImageSet;
  rating: number | null;
  releaseYear: number | null;
};

export type MetadataPersonDetail = {
  provider: 'tmdb';
  providerId: string;
  tmdbPersonId: number;
  name: string;
  knownForDepartment: string | null;
  biography: string | null;
  birthday: string | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  imdbId: string | null;
  instagramId: string | null;
  twitterId: string | null;
  knownFor: MetadataPersonKnownForItem[];
};

export type MetadataSearchFilter = 'all' | 'movies' | 'series' | 'people';

export type MetadataSearchResult = {
  kind: 'search_result';
  mediaItem: MediaItem;
  context: Record<string, unknown>;
  presentation: MediaPresentationHint | null;
};

export type MetadataPersonSearchResult = {
  kind: 'person_search_result';
  tmdbPersonId: number;
  name: string;
  knownForDepartment: string | null;
  profileUrl: string | null;
  knownForTitles: string[];
};

export type SearchSuggestionItem = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: number | null;
  posterPath: string | null;
  popularity: number;
  overview: string | null;
};

export type MetadataSearchResponse = {
  query: string;
  all: MetadataSearchResult[];
  movies: MetadataSearchResult[];
  series: MetadataSearchResult[];
  people: MetadataPersonSearchResult[];
};

export type MetadataResolveResponse = {
  item: MetadataView;
};
