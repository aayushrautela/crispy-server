import type { SupportedProvider } from '../identity/media-key.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';
import type { ResponsiveImageSet } from './metadata-card.types.js';

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
  personId: string;
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

export type MetadataProductionInfoView = {
  originalLanguage: string | null;
  originCountries: string[];
  spokenLanguages: string[];
  productionCountries: string[];
  companies: MetadataCompanyView[];
  networks: MetadataCompanyView[];
};

export type MetadataTitleDetail = {
  Item: ClientMediaCard;
  NextEpisode: ClientMediaCard | null;
  Videos: MetadataVideoView[];
  Cast: MetadataPersonRefView[];
  Creators: MetadataPersonRefView[];
  Directors: MetadataPersonRefView[];
  Production: MetadataProductionInfoView;
  Backdrops: string[];
};

export type MetadataTitleReviewsResponse = {
  Reviews: MetadataReviewView[];
};

export type MetadataTitleRatingsResponse = {
  Ratings: {
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

export type MetadataTitleExtrasInternal = {
  resolvedTitle: import('./providers/tmdb.types.js').TmdbTitleRecord;
  seasonIdentities: import('../identity/media-key.js').MediaIdentity[];
  seriesItemId: string;
  seriesTitle: string | null;
  similar: import('../identity/media-key.js').MediaIdentity[];
  collection: import('../identity/media-key.js').MediaIdentity[] | null;
  collectionName: string | null;
  reviews: MetadataReviewView[];
  effectiveLanguage: string | null;
};

export type PlaybackResolveResponse = {
  Item: ClientMediaCard;
  Show: ClientMediaCard | null;
  Season: ClientMediaCard | null;
};

export type MetadataPersonDetail = {
  personId: string;
  name: string;
  knownForDepartment: string | null;
  biography: string | null;
  birthday: string | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  knownFor: ClientMediaCard[];
};

export type MetadataSearchFilter = 'all' | 'movies' | 'series' | 'people';

export type MetadataSearchResult = ClientMediaCard;

export type MetadataPersonSearchResult = {
  kind: 'person_search_result';
  personId: string;
  name: string;
  knownForDepartment: string | null;
  profileUrl: string | null;
  knownForTitles: string[];
};

export type SearchSuggestionItem = {
  Id: string;
  Type: 'Movie' | 'Series';
  Name: string;
  ProductionYear: number | null;
  ImageTags: {
    Primary: ResponsiveImageSet | null;
  } | null;
  ProviderIds: {
    Tmdb: string | null;
  };
};

export type MetadataSearchResponse = {
  query: string;
  movies: ClientMediaCard[];
  series: ClientMediaCard[];
  people: MetadataPersonSearchResult[];
};
