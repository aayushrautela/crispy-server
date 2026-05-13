import {
  regularCardViewSchema,
  nonEmptyStringSchema,
  nullableNumberSchema,
  profileIdParamsSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';

const aiSearchItemSchema = regularCardViewSchema;

const aiSearchResponseSchema = {
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
} as const;

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
    200: successEnvelope(aiSearchResponseSchema),
  },
});

const aiInsightItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'title', 'content', 'type'],
  properties: {
    category: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    content: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
  },
} as const;

const aiInsightsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['insights', 'trivia'],
  properties: {
    insights: {
      type: 'array',
      items: aiInsightItemSchema,
    },
    trivia: stringSchema,
  },
} as const;

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
    200: successEnvelope(aiInsightsResponseSchema),
  },
});
