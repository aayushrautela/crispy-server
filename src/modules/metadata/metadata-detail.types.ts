import type { SupportedProvider } from '../identity/media-key.js';
import type {
  CatalogItem,
  MetadataExternalIds,
  MetadataEpisodePreview,
  MetadataImages,
  MetadataParentMediaType,
  MetadataTitleMediaType,
  MetadataViewMediaType,
  ProviderTitleRecord,
} from './metadata-card.types.js';

export type MetadataView = {
  mediaType: MetadataViewMediaType;
  kind: 'title' | 'episode';
  mediaKey: string;
  provider: SupportedProvider;
  providerId: string;
  parentMediaType: MetadataParentMediaType | null;
  parentProvider: SupportedProvider | null;
  parentProviderId: string | null;
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
  certification: string | null;
  status: string | null;
  genres: string[];
  externalIds: MetadataExternalIds;
  seasonCount: number | null;
  episodeCount: number | null;
  nextEpisode: MetadataEpisodePreview | null;
};

export type MetadataSeasonView = {
  mediaKey: string;
  provider: SupportedProvider;
  providerId: string;
  parentMediaType: MetadataParentMediaType;
  parentProvider: SupportedProvider;
  parentProviderId: string;
  showTmdbId: number | null;
  seasonNumber: number;
  title: string | null;
  summary: string | null;
  airDate: string | null;
  episodeCount: number | null;
  images: {
    posterUrl: string | null;
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

export type MetadataReviewView = {
  id: string;
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
  logoUrl: string | null;
  originCountry: string | null;
};

export type MetadataCollectionView = {
  id: number | string;
  provider: SupportedProvider;
  providerId: string;
  name: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  parts: CatalogItem[];
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
  seasons: MetadataSeasonView[];
  videos: MetadataVideoView[];
  cast: MetadataPersonRefView[];
  directors: MetadataPersonRefView[];
  creators: MetadataPersonRefView[];
  production: MetadataProductionInfoView;
  collection: MetadataCollectionView | null;
  similar: CatalogItem[];
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
    myAnimeList: number | null;
  };
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

export type MdbContentView = {
  ids: {
    imdb: string | null;
    tmdb: number | null;
    trakt: number | null;
    tvdb: number | null;
  };
  title: string | null;
  originalTitle: string | null;
  type: string | null;
  year: number | null;
  description: string | null;
  score: number | null;
  ratings: {
    imdbRating: number | null;
    imdbVotes: number | null;
    tmdbRating: number | null;
    metacritic: number | null;
    rottenTomatoes: number | null;
    letterboxdRating: number | null;
  };
  posterUrl: string | null;
  backdropUrl: string | null;
  genres: string[];
  keywords: string[];
  runtime: number | null;
  certification: string | null;
  released: string | null;
  language: string | null;
  country: string | null;
  seasonCount: number | null;
  episodeCount: number | null;
  directors: string[];
  writers: string[];
  network: string | null;
  studio: string | null;
  status: string | null;
  budget: number | null;
  revenue: number | null;
  updatedAt: string | null;
};

export type MetadataTitleContentResponse = {
  item: MetadataView;
  content: MdbContentView;
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
  posterUrl: string | null;
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

export type MetadataSearchFilter = 'all' | 'movies' | 'series' | 'anime';
export type MetadataSearchResult = CatalogItem;

export type MetadataSearchResponse = {
  query: string;
  items: MetadataSearchResult[];
};

export type MetadataResolveResponse = {
  item: MetadataView;
};

export type { ProviderTitleRecord };
