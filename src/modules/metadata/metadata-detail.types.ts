import type { SupportedProvider } from '../identity/media-key.js';
import type { BaseItemDto, BaseItemDtoQueryResult } from './media-item.types.js';
import type { MetadataTitleMediaType, ResponsiveImageSet } from './metadata-card.types.js';

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
  Item: BaseItemDto;
  NextEpisode: BaseItemDto | null;
  Videos: MetadataVideoView[];
  Cast: MetadataPersonRefView[];
  Directors: MetadataPersonRefView[];
  Creators: MetadataPersonRefView[];
  Production: MetadataProductionInfoView;
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

export type MetadataTitleExtras = {
  Seasons: BaseItemDto[];
  Episodes: BaseItemDto[];
  Reviews: MetadataReviewView[];
  Similar: BaseItemDto[];
  Collection: BaseItemDtoQueryResult | null;
};

export type MetadataResolveResponse = {
  Item: BaseItemDto;
};

export type PlaybackResolveResponse = {
  Item: BaseItemDto;
  Show: BaseItemDto | null;
  Season: BaseItemDto | null;
};

export type MetadataSeasonDetail = {
  Show: BaseItemDto;
  Season: BaseItemDto;
  Episodes: BaseItemDto[];
};

export type MetadataEpisodeListResponse = {
  Show: BaseItemDto;
  RequestedSeasonNumber: number | null;
  EffectiveSeasonNumber: number;
  IncludedSeasonNumbers: number[];
  Episodes: BaseItemDto[];
};

export type MetadataNextEpisodeResponse = {
  Show: BaseItemDto;
  CurrentSeasonNumber: number;
  CurrentEpisodeNumber: number;
  Item: BaseItemDto | null;
};

export type MetadataPersonKnownForItem = {
  mediaType: MetadataTitleMediaType;
  itemId: string;
  title: string;
  poster: ResponsiveImageSet;
  rating: number | null;
  releaseYear: number | null;
};

export type MetadataPersonDetail = {
  personId: string;
  name: string;
  knownForDepartment: string | null;
  biography: string | null;
  birthday: string | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  knownFor: MetadataPersonKnownForItem[];
};

export type MetadataSearchFilter = 'all' | 'movies' | 'series' | 'people';

export type MetadataSearchResult = BaseItemDto;

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
  all: BaseItemDto[];
  movies: BaseItemDto[];
  series: BaseItemDto[];
  people: MetadataPersonSearchResult[];
};
