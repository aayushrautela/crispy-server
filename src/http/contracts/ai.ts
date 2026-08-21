import {
  baseItemDtoSchema,
  nonEmptyStringSchema,
  profileIdParamsSchema,
  publicItemIdSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';
import { metadataPersonSearchResultSchema } from './metadata.js';

const aiSearchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'movies', 'series', 'people'],
  properties: {
    query: stringSchema,
    movies: {
      type: 'array',
      items: baseItemDtoSchema,
    },
    series: {
      type: 'array',
      items: baseItemDtoSchema,
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
    required: ['itemId'],
    properties: {
      itemId: publicItemIdSchema,
      locale: stringSchema,
    },
  },
  response: {
    200: successEnvelope(aiInsightsResponseSchema),
  },
});
