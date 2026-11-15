import {
  clientMediaCardSchema,
  nonEmptyStringSchema,
  profileIdParamsSchema,
  publicItemIdSchema,
  responsiveImageSetSchema,
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
      items: clientMediaCardSchema,
    },
    series: {
      type: 'array',
      items: clientMediaCardSchema,
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

const aiInsightSlideSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'label', 'kind', 'heading', 'body', 'backdrop', 'accent'],
  properties: {
    key: {
      type: 'string',
      enum: ['the_good_stuff', 'the_catch', 'standout_element', 'trivia'],
    },
    label: nonEmptyStringSchema,
    kind: {
      type: 'string',
      enum: ['prose', 'standout', 'trivia'],
    },
    heading: nonEmptyStringSchema,
    body: nonEmptyStringSchema,
    backdrop: responsiveImageSetSchema,
    accent: nonEmptyStringSchema,
  },
} as const;

const aiInsightsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slides'],
  properties: {
    slides: {
      type: 'array',
      items: aiInsightSlideSchema,
    },
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
