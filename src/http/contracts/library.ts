import {
  booleanSchema,
  positiveIntegerLikeSchema,
  profileIdParamsSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type LibraryProfileParams = {
  profileId: string;
};

export type LibraryQuery = {
  source?: string;
  limitPerFolder?: number | string;
};

export type LibraryMutationBody = {
  source?: string;
  inWatchlist?: boolean;
  rating?: number | string | null;
  id?: string;
  tmdbId?: number | string;
  imdbId?: string;
  tvdbId?: number | string;
  mediaType?: string;
  seasonNumber?: number | string;
  episodeNumber?: number | string;
};

export const profileLibraryRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: stringSchema,
      limitPerFolder: positiveIntegerLikeSchema,
    },
  },
});

export const providerAuthStateRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
});

export const libraryWatchlistRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: stringSchema,
      inWatchlist: booleanSchema,
      id: stringSchema,
      tmdbId: positiveIntegerLikeSchema,
      imdbId: stringSchema,
      tvdbId: positiveIntegerLikeSchema,
      mediaType: stringSchema,
      seasonNumber: positiveIntegerLikeSchema,
      episodeNumber: positiveIntegerLikeSchema,
    },
  },
});

export const libraryRatingRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: stringSchema,
      rating: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
      id: stringSchema,
      tmdbId: positiveIntegerLikeSchema,
      imdbId: stringSchema,
      tvdbId: positiveIntegerLikeSchema,
      mediaType: stringSchema,
      seasonNumber: positiveIntegerLikeSchema,
      episodeNumber: positiveIntegerLikeSchema,
    },
  },
});
