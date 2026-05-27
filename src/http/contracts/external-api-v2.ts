import { nonEmptyStringSchema, nullableStringSchema, stringSchema, successEnvelope, withDefaultErrorResponses } from './shared.js';

const profileIdParams = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId'],
  properties: {
    profileId: nonEmptyStringSchema,
  },
} as const;

const historyItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tmdbId', 'mediaType', 'watchedAt'],
  properties: {
    tmdbId: { type: 'number' },
    mediaType: { type: 'string', enum: ['Movie', 'Series', 'Episode'] },
    title: nullableStringSchema,
    seasonNumber: { type: 'number' },
    episodeNumber: { type: 'number' },
    seriesTmdbId: { type: 'number' },
    seriesName: nullableStringSchema,
    watchedAt: stringSchema,
  },
} as const;

const watchlistItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tmdbId', 'mediaType', 'addedAt'],
  properties: {
    tmdbId: { type: 'number' },
    mediaType: { type: 'string', enum: ['Movie', 'Series'] },
    title: nullableStringSchema,
    addedAt: stringSchema,
  },
} as const;

const ratingItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tmdbId', 'mediaType', 'score', 'ratedAt'],
  properties: {
    tmdbId: { type: 'number' },
    mediaType: { type: 'string', enum: ['Movie', 'Series', 'Episode'] },
    title: nullableStringSchema,
    score: { type: 'number' },
    ratedAt: stringSchema,
  },
} as const;

const paginationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: nullableStringSchema,
    limit: { type: 'number' },
  },
} as const;

export const externalApiV2HistoryRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  querystring: paginationSchema,
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: historyItemSchema },
        nextCursor: nullableStringSchema,
        hasMore: { type: 'boolean' },
      },
    }),
  },
});

export const externalApiV2WatchlistRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  querystring: paginationSchema,
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: watchlistItemSchema },
        nextCursor: nullableStringSchema,
        hasMore: { type: 'boolean' },
      },
    }),
  },
});

export const externalApiV2RatingsRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  querystring: paginationSchema,
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: ratingItemSchema },
        nextCursor: nullableStringSchema,
        hasMore: { type: 'boolean' },
      },
    }),
  },
});
