export type TmdbTitleType = 'movie' | 'tv';
export type TmdbHydrationLevel = 'summary' | 'detail' | 'not_found';
export type TmdbRelationKind = 'recommendation' | 'similar' | 'collection_part';

export type TmdbReviewRecord = {
  mediaType: TmdbTitleType;
  tmdbId: number;
  source: 'tmdb' | 'trakt';
  reviewKey: string;
  author: string | null;
  authorUsername: string | null;
  content: string;
  lang: string | null;
  url: string | null;
  rating: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
};

export type TmdbImageRecord = {
  kind: 'poster' | 'backdrop' | 'logo';
  filePath: string;
  iso6391: string | null;
  expiresAt?: string;
};

export type TmdbTranslationEntry = {
  lang: string;
  name: string | null;
  overview: string | null;
  tagline: string | null;
};

export type TmdbRelationTarget = {
  targetMediaType: TmdbTitleType;
  targetTmdbId: number;
  rank: number;
};

export type TmdbTitleRecord = {
  mediaType: TmdbTitleType;
  tmdbId: number;
  language: string;
  name: string | null;
  originalName: string | null;
  overview: string | null;
  tagline: string | null;
  releaseDate: string | null;
  firstAirDate: string | null;
  status: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  logoPath?: string | null;
  runtime: number | null;
  episodeRunTime: number[];
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  externalIds: Record<string, unknown>;
  genreIds?: number[];
  voteAverage?: number | null;
  raw: Record<string, unknown>;
  hydrationLevel?: TmdbHydrationLevel;
  fetchedAt: string;
  expiresAt: string;
};

export type TmdbEpisodeRecord = {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  tmdbId: number | null;
  name: string | null;
  overview: string | null;
  airDate: string | null;
  runtime: number | null;
  stillPath: string | null;
  voteAverage: number | null;
  raw: Record<string, unknown>;
  fetchedAt: string;
  expiresAt: string;
};

export type TmdbSeasonRecord = {
  showTmdbId: number;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  airDate: string | null;
  posterPath: string | null;
  episodeCount: number | null;
  raw: Record<string, unknown>;
  fetchedAt: string;
  expiresAt: string;
};

export type TmdbTitleApiResponse = Record<string, unknown>;
export type TmdbCollectionApiResponse = Record<string, unknown>;
export type TmdbSeasonApiResponse = Record<string, unknown>;
export type TmdbSearchApiResponse = Record<string, unknown>;
export type TmdbSearchResultItem = {
  id?: unknown;
  media_type?: unknown;
};
export type TmdbDiscoverApiResponse = Record<string, unknown>;
export type TmdbPersonApiResponse = Record<string, unknown>;

export type TmdbPersonRecord = {
  tmdbPersonId: number;
  name: string;
  knownForDepartment: string | null;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  profilePath: string | null;
  popularity: number;
  homepage: string | null;
  knownFor?: Array<{ mediaType: string; title: string | null; tmdbId: number }>;
  raw?: Record<string, unknown> | null;
  fetchedAt: string;
  expiresAt: string;
};
