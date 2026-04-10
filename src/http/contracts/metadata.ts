import {
  booleanSchema,
  integerLikeSchema,
  metadataCardViewSchema,
  metadataImagesSchema,
  nullableIntegerSchema,
  nullableNumberSchema,
  nullableStringSchema,
  nonEmptyStringSchema,
  positiveIntegerLikeSchema,
  profileIdAndMediaKeyParamsSchema,
  regularCardViewSchema,
  stringListSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type MetadataResolveQuery = {
  mediaKey?: string;
  imdbId?: string;
  mediaType?: string;
  provider?: string;
  providerId?: number | string;
  parentProvider?: string;
  parentProviderId?: number | string;
  seasonNumber?: number | string;
  episodeNumber?: number | string;
  language?: string;
};

export type MetadataTitleParams = {
  mediaKey: string;
};

export type MetadataSeasonParams = {
  mediaKey: string;
  seasonNumber: number | string;
};

export type MetadataPersonParams = {
  id: string;
};

export type MetadataPersonQuery = {
  language?: string;
};

export type MetadataEpisodesQuery = {
  seasonNumber?: number | string;
  language?: string;
};

export type MetadataNextEpisodeQuery = {
  currentSeasonNumber?: number | string;
  currentEpisodeNumber?: number | string;
  watchedKeys?: string | string[];
  showMediaKey?: string;
  nowMs?: number | string;
  language?: string;
};

export type MetadataSearchQuery = {
  query?: string;
  genre?: string;
  filter?: string;
  limit?: number | string;
};

const metadataResolveQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mediaKey: stringSchema,
    imdbId: stringSchema,
    mediaType: stringSchema,
    provider: stringSchema,
    providerId: positiveIntegerLikeSchema,
    parentProvider: stringSchema,
    parentProviderId: positiveIntegerLikeSchema,
    seasonNumber: positiveIntegerLikeSchema,
    episodeNumber: positiveIntegerLikeSchema,
    language: stringSchema,
  },
} as const;

const metadataLanguageQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: stringSchema,
  },
} as const;

const metadataTitleParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mediaKey'],
  properties: {
    mediaKey: nonEmptyStringSchema,
  },
} as const;

const metadataSeasonParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mediaKey', 'seasonNumber'],
  properties: {
    mediaKey: nonEmptyStringSchema,
    seasonNumber: positiveIntegerLikeSchema,
  },
} as const;

const metadataExternalIdsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tmdb', 'imdb', 'tvdb', 'kitsu'],
  properties: {
    tmdb: nullableIntegerSchema,
    imdb: nullableStringSchema,
    tvdb: nullableIntegerSchema,
    kitsu: nullableStringSchema,
  },
} as const;

const metadataEpisodePreviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'mediaType',
    'mediaKey',
    'provider',
    'providerId',
    'parentMediaType',
    'parentProvider',
    'parentProviderId',
    'tmdbId',
    'showTmdbId',
    'seasonNumber',
    'episodeNumber',
    'absoluteEpisodeNumber',
    'title',
    'summary',
    'airDate',
    'runtimeMinutes',
    'rating',
    'images',
  ],
  properties: {
    mediaType: stringSchema,
    mediaKey: stringSchema,
    provider: stringSchema,
    providerId: stringSchema,
    parentMediaType: stringSchema,
    parentProvider: stringSchema,
    parentProviderId: stringSchema,
    tmdbId: nullableIntegerSchema,
    showTmdbId: nullableIntegerSchema,
    seasonNumber: { type: 'integer' },
    episodeNumber: { type: 'integer' },
    absoluteEpisodeNumber: nullableIntegerSchema,
    title: nullableStringSchema,
    summary: nullableStringSchema,
    airDate: nullableStringSchema,
    runtimeMinutes: nullableIntegerSchema,
    rating: nullableNumberSchema,
    images: metadataImagesSchema,
  },
} as const;

const metadataViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...metadataCardViewSchema.required,
    'certification',
    'genres',
    'externalIds',
    'seasonCount',
    'episodeCount',
    'nextEpisode',
  ],
  properties: {
    ...metadataCardViewSchema.properties,
    certification: nullableStringSchema,
    genres: {
      type: 'array',
      items: stringSchema,
    },
    externalIds: metadataExternalIdsSchema,
    seasonCount: nullableIntegerSchema,
    episodeCount: nullableIntegerSchema,
    nextEpisode: {
      anyOf: [
        metadataEpisodePreviewSchema,
        { type: 'null' },
      ],
    },
  },
} as const;

const metadataSeasonViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'mediaKey',
    'provider',
    'providerId',
    'parentMediaType',
    'parentProvider',
    'parentProviderId',
    'showTmdbId',
    'seasonNumber',
    'title',
    'summary',
    'airDate',
    'episodeCount',
    'images',
  ],
  properties: {
    mediaKey: stringSchema,
    provider: stringSchema,
    providerId: stringSchema,
    parentMediaType: stringSchema,
    parentProvider: stringSchema,
    parentProviderId: stringSchema,
    showTmdbId: nullableIntegerSchema,
    seasonNumber: { type: 'integer' },
    title: nullableStringSchema,
    summary: nullableStringSchema,
    airDate: nullableStringSchema,
    episodeCount: nullableIntegerSchema,
    images: {
      type: 'object',
      additionalProperties: false,
      required: ['posterUrl'],
      properties: {
        posterUrl: nullableStringSchema,
      },
    },
  },
} as const;

const metadataEpisodeViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...metadataEpisodePreviewSchema.required,
    'showTitle',
    'showExternalIds',
  ],
  properties: {
    ...metadataEpisodePreviewSchema.properties,
    showTitle: nullableStringSchema,
    showExternalIds: metadataExternalIdsSchema,
  },
} as const;

const metadataVideoViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'key', 'name', 'site', 'type', 'official', 'publishedAt', 'url', 'thumbnailUrl'],
  properties: {
    id: stringSchema,
    key: stringSchema,
    name: nullableStringSchema,
    site: nullableStringSchema,
    type: nullableStringSchema,
    official: booleanSchema,
    publishedAt: nullableStringSchema,
    url: nullableStringSchema,
    thumbnailUrl: nullableStringSchema,
  },
} as const;

const metadataPersonRefViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'providerId', 'tmdbPersonId', 'name', 'role', 'department', 'profileUrl'],
  properties: {
    id: stringSchema,
    provider: stringSchema,
    providerId: stringSchema,
    tmdbPersonId: nullableIntegerSchema,
    name: stringSchema,
    role: nullableStringSchema,
    department: nullableStringSchema,
    profileUrl: nullableStringSchema,
  },
} as const;

const metadataReviewViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'author', 'username', 'content', 'createdAt', 'updatedAt', 'url', 'rating', 'avatarUrl'],
  properties: {
    id: stringSchema,
    provider: stringSchema,
    author: nullableStringSchema,
    username: nullableStringSchema,
    content: stringSchema,
    createdAt: nullableStringSchema,
    updatedAt: nullableStringSchema,
    url: nullableStringSchema,
    rating: nullableNumberSchema,
    avatarUrl: nullableStringSchema,
  },
} as const;

const stringOrIntegerSchema = {
  anyOf: [
    { type: 'integer' },
    stringSchema,
  ],
} as const;

const metadataCompanyViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'providerId', 'name', 'logoUrl', 'originCountry'],
  properties: {
    id: stringOrIntegerSchema,
    provider: stringSchema,
    providerId: stringSchema,
    name: stringSchema,
    logoUrl: nullableStringSchema,
    originCountry: nullableStringSchema,
  },
} as const;

const metadataCollectionViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'providerId', 'name', 'posterUrl', 'backdropUrl', 'parts'],
  properties: {
    id: stringOrIntegerSchema,
    provider: stringSchema,
    providerId: stringSchema,
    name: stringSchema,
    posterUrl: nullableStringSchema,
    backdropUrl: nullableStringSchema,
    parts: {
      type: 'array',
      items: regularCardViewSchema,
    },
  },
} as const;

const metadataProductionInfoViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['originalLanguage', 'originCountries', 'spokenLanguages', 'productionCountries', 'companies', 'networks'],
  properties: {
    originalLanguage: nullableStringSchema,
    originCountries: { type: 'array', items: stringSchema },
    spokenLanguages: { type: 'array', items: stringSchema },
    productionCountries: { type: 'array', items: stringSchema },
    companies: { type: 'array', items: metadataCompanyViewSchema },
    networks: { type: 'array', items: metadataCompanyViewSchema },
  },
} as const;

const metadataTitleDetailResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['item', 'seasons', 'episodes', 'nextEpisode', 'videos', 'cast', 'directors', 'creators', 'production', 'collection', 'similar'],
  properties: {
    item: metadataViewSchema,
    seasons: { type: 'array', items: metadataSeasonViewSchema },
    episodes: { type: 'array', items: metadataEpisodeViewSchema },
    nextEpisode: {
      anyOf: [
        metadataEpisodeViewSchema,
        { type: 'null' },
      ],
    },
    videos: { type: 'array', items: metadataVideoViewSchema },
    cast: { type: 'array', items: metadataPersonRefViewSchema },
    directors: { type: 'array', items: metadataPersonRefViewSchema },
    creators: { type: 'array', items: metadataPersonRefViewSchema },
    production: metadataProductionInfoViewSchema,
    collection: {
      anyOf: [
        metadataCollectionViewSchema,
        { type: 'null' },
      ],
    },
    similar: { type: 'array', items: regularCardViewSchema },
  },
} as const;

const metadataTitleReviewsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reviews'],
  properties: {
    reviews: { type: 'array', items: metadataReviewViewSchema },
  },
} as const;

const metadataTitleRatingsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ratings'],
  properties: {
    ratings: {
      type: 'object',
      additionalProperties: false,
      required: ['imdb', 'tmdb', 'trakt', 'metacritic', 'rottenTomatoes', 'audience', 'letterboxd', 'rogerEbert', 'myAnimeList'],
      properties: {
        imdb: nullableNumberSchema,
        tmdb: nullableNumberSchema,
        trakt: nullableNumberSchema,
        metacritic: nullableNumberSchema,
        rottenTomatoes: nullableNumberSchema,
        audience: nullableNumberSchema,
        letterboxd: nullableNumberSchema,
        rogerEbert: nullableNumberSchema,
        myAnimeList: nullableNumberSchema,
      },
    },
  },
} as const;

const metadataResolveResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: metadataViewSchema,
  },
} as const;

const metadataPersonKnownForItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mediaType', 'mediaKey', 'provider', 'providerId', 'tmdbId', 'title', 'posterUrl', 'rating', 'releaseYear'],
  properties: {
    mediaType: stringSchema,
    mediaKey: stringSchema,
    provider: stringSchema,
    providerId: stringSchema,
    tmdbId: { type: 'integer' },
    title: stringSchema,
    posterUrl: nullableStringSchema,
    rating: nullableNumberSchema,
    releaseYear: nullableIntegerSchema,
  },
} as const;

const metadataPersonDetailResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'providerId', 'tmdbPersonId', 'name', 'knownForDepartment', 'biography', 'birthday', 'placeOfBirth', 'profileUrl', 'imdbId', 'instagramId', 'twitterId', 'knownFor'],
  properties: {
    id: stringSchema,
    provider: stringSchema,
    providerId: stringSchema,
    tmdbPersonId: { type: 'integer' },
    name: stringSchema,
    knownForDepartment: nullableStringSchema,
    biography: nullableStringSchema,
    birthday: nullableStringSchema,
    placeOfBirth: nullableStringSchema,
    profileUrl: nullableStringSchema,
    imdbId: nullableStringSchema,
    instagramId: nullableStringSchema,
    twitterId: nullableStringSchema,
    knownFor: { type: 'array', items: metadataPersonKnownForItemSchema },
  },
} as const;

const playbackResolveResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['item', 'show', 'season'],
  properties: {
    item: metadataViewSchema,
    show: {
      anyOf: [
        metadataViewSchema,
        { type: 'null' },
      ],
    },
    season: {
      anyOf: [
        metadataSeasonViewSchema,
        { type: 'null' },
      ],
    },
  },
} as const;

const metadataSearchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'all', 'movies', 'series', 'anime'],
  properties: {
    query: stringSchema,
    all: {
      type: 'array',
      items: regularCardViewSchema,
    },
    movies: {
      type: 'array',
      items: regularCardViewSchema,
    },
    series: {
      type: 'array',
      items: regularCardViewSchema,
    },
    anime: {
      type: 'array',
      items: regularCardViewSchema,
    },
  },
} as const;

export const metadataResolveRouteSchema = withDefaultErrorResponses({
  querystring: metadataResolveQuerystringSchema,
  response: {
    200: metadataResolveResponseSchema,
  },
});

export const metadataTitleDetailRouteSchema = withDefaultErrorResponses({
  params: metadataTitleParamsSchema,
  querystring: metadataLanguageQuerystringSchema,
  response: {
    200: metadataTitleDetailResponseSchema,
  },
});

export const metadataTitleReviewsRouteSchema = withDefaultErrorResponses({
  params: profileIdAndMediaKeyParamsSchema,
  querystring: metadataLanguageQuerystringSchema,
  response: {
    200: metadataTitleReviewsResponseSchema,
  },
});

export const metadataTitleRatingsRouteSchema = withDefaultErrorResponses({
  params: profileIdAndMediaKeyParamsSchema,
  response: {
    200: metadataTitleRatingsResponseSchema,
  },
});

export const metadataPersonRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: nonEmptyStringSchema,
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      language: stringSchema,
    },
  },
  response: {
    200: metadataPersonDetailResponseSchema,
  },
});

export const playbackResolveRouteSchema = withDefaultErrorResponses({
  querystring: metadataResolveQuerystringSchema,
  response: {
    200: playbackResolveResponseSchema,
  },
});

export const metadataSearchRouteSchema = withDefaultErrorResponses({
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: stringSchema,
      genre: stringSchema,
      filter: stringSchema,
      limit: positiveIntegerLikeSchema,
    },
  },
  response: {
    200: metadataSearchResponseSchema,
  },
});
