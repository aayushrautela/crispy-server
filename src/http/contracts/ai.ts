import {
  regularCardViewSchema,
  nonEmptyStringSchema,
  nullableNumberSchema,
  profileIdParamsSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

const nullableStringSchema = {
  anyOf: [
    stringSchema,
    { type: 'null' },
  ],
} as const;

const nullableIntegerSchema = {
  anyOf: [
    { type: 'integer' },
    { type: 'null' },
  ],
} as const;

const metadataArtworkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['posterUrl', 'backdropUrl', 'stillUrl'],
  properties: {
    posterUrl: nullableStringSchema,
    backdropUrl: nullableStringSchema,
    stillUrl: nullableStringSchema,
  },
} as const;

const metadataImagesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['posterUrl', 'backdropUrl', 'stillUrl', 'logoUrl'],
  properties: {
    posterUrl: nullableStringSchema,
    backdropUrl: nullableStringSchema,
    stillUrl: nullableStringSchema,
    logoUrl: nullableStringSchema,
  },
} as const;

const aiSearchItemSchema = regularCardViewSchema;

export const aiSearchRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
      additionalProperties: false,
      properties: {
        query: stringSchema,
        locale: stringSchema,
      },
    },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'all', 'movies', 'series', 'anime'],
      properties: {
        query: stringSchema,
        all: {
          type: 'array',
          items: aiSearchItemSchema,
        },
        movies: {
          type: 'array',
          items: aiSearchItemSchema,
        },
        series: {
          type: 'array',
          items: aiSearchItemSchema,
        },
        anime: {
          type: 'array',
          items: aiSearchItemSchema,
        },
      },
    },
  },
});

export const aiInsightsRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['mediaKey'],
    properties: {
      mediaKey: nonEmptyStringSchema,
      locale: stringSchema,
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['insights', 'trivia'],
      properties: {
        insights: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['category', 'title', 'content', 'type'],
            properties: {
              category: nonEmptyStringSchema,
              title: nonEmptyStringSchema,
              content: nonEmptyStringSchema,
              type: nonEmptyStringSchema,
            },
          },
        },
        trivia: stringSchema,
      },
    },
  },
});
