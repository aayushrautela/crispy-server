import {
  nonEmptyStringSchema,
  nullableNumberSchema,
  profileIdParamsSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';
import { metadataSearchResultSchema, metadataPersonSearchResultSchema } from './metadata.js';

const aiSearchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'all', 'movies', 'series', 'people'],
  properties: {
    query: stringSchema,
    all: {
      type: 'array',
      items: metadataSearchResultSchema,
    },
    movies: {
      type: 'array',
      items: metadataSearchResultSchema,
    },
    series: {
      type: 'array',
      items: metadataSearchResultSchema,
    },
    people: {
      type: 'array',
      items: metadataPersonSearchResultSchema,
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
