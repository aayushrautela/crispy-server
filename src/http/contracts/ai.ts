import {
  baseItemDtoSchema,
  nonEmptyStringSchema,
  nullableStringSchema,
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

const aiStandoutTagSchema = {
  type: 'string',
  enum: ['PERFORMANCE', 'VISUALS', 'STORY', 'DIRECTION', 'WORLD_BUILDING'],
} as const;

const aiInsightSlideSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'label', 'kind', 'body', 'tag', 'focus', 'context', 'backdrop', 'accent'],
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
    body: nullableStringSchema,
    tag: {
      anyOf: [aiStandoutTagSchema, { type: 'null' }],
    },
    focus: nullableStringSchema,
    context: nullableStringSchema,
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
