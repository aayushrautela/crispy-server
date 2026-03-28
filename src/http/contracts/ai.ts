import {
  nonEmptyStringSchema,
  profileIdParamsSchema,
  positiveIntegerLikeSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

const nullableStringSchema = {
  anyOf: [
    stringSchema,
    { type: 'null' },
  ],
} as const;

const aiSearchItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'mediaType', 'title', 'year', 'posterUrl', 'backdropUrl', 'rating', 'overview'],
  properties: {
    id: { type: 'integer' },
    mediaType: { type: 'string', enum: ['movie', 'tv'] },
    title: nonEmptyStringSchema,
    year: nullableStringSchema,
    posterUrl: nullableStringSchema,
    backdropUrl: nullableStringSchema,
    rating: nullableStringSchema,
    overview: nullableStringSchema,
  },
} as const;

export const aiSearchRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: stringSchema,
      filter: stringSchema,
      locale: stringSchema,
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
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
    properties: {
      provider: stringSchema,
      providerId: positiveIntegerLikeSchema,
      mediaType: stringSchema,
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
