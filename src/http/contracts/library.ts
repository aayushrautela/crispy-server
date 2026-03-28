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
  imdbId?: string;
  mediaType?: string;
  provider?: string;
  providerId?: number | string;
  parentProvider?: string;
  parentProviderId?: number | string;
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
      imdbId: stringSchema,
      mediaType: stringSchema,
      provider: stringSchema,
      providerId: positiveIntegerLikeSchema,
      parentProvider: stringSchema,
      parentProviderId: positiveIntegerLikeSchema,
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
      imdbId: stringSchema,
      mediaType: stringSchema,
      provider: stringSchema,
      providerId: positiveIntegerLikeSchema,
      parentProvider: stringSchema,
      parentProviderId: positiveIntegerLikeSchema,
      seasonNumber: positiveIntegerLikeSchema,
      episodeNumber: positiveIntegerLikeSchema,
    },
  },
});
