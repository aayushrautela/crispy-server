import {
  integerLikeSchema,
  nonEmptyStringSchema,
  positiveIntegerLikeSchema,
  stringListSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type MetadataResolveQuery = {
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

export type MetadataTitleParams = {
  id: string;
};

export type MetadataSeasonParams = {
  id: string;
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
};

export type MetadataNextEpisodeQuery = {
  currentSeasonNumber?: number | string;
  currentEpisodeNumber?: number | string;
  watchedKeys?: string | string[];
  showId?: string;
  nowMs?: number | string;
};

export type MetadataSearchQuery = {
  query?: string;
  genre?: string;
  filter?: string;
  limit?: number | string;
};

export const metadataResolveRouteSchema = withDefaultErrorResponses({
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
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

export const metadataTitleParamsRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: nonEmptyStringSchema,
    },
  },
});

export const metadataSeasonRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'seasonNumber'],
    properties: {
      id: nonEmptyStringSchema,
      seasonNumber: positiveIntegerLikeSchema,
    },
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
});

export const metadataEpisodesRouteSchema = withDefaultErrorResponses({
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
      seasonNumber: positiveIntegerLikeSchema,
    },
  },
});

export const metadataNextEpisodeRouteSchema = withDefaultErrorResponses({
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
      currentSeasonNumber: positiveIntegerLikeSchema,
      currentEpisodeNumber: positiveIntegerLikeSchema,
      watchedKeys: stringListSchema,
      showId: stringSchema,
      nowMs: integerLikeSchema,
    },
  },
});

export const playbackResolveRouteSchema = metadataResolveRouteSchema;

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
});
