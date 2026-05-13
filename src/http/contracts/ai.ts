import {
  regularCardViewSchema,
  nonEmptyStringSchema,
  nullableNumberSchema,
  profileIdParamsSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

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
      required: ['query', 'all', 'movies', 'series'],
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
