import {
  collectionCardViewSchema,
  heroCardViewSchema,
  landscapeCardViewSchema,
  nullableNumberSchema,
  nullableStringSchema,
  profileIdParamsSchema,
  recordSchema,
  regularCardViewSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';
import { calendarItemSchema } from './calendar.js';
import { continueWatchingItemSchema } from './watch.js';

export type HomeProfileParams = {
  profileId: string;
};

const recommendationRegularItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['media', 'reason', 'score', 'rank', 'payload'],
  properties: {
    media: regularCardViewSchema,
    reason: nullableStringSchema,
    score: nullableNumberSchema,
    rank: { type: 'number' },
    payload: recordSchema,
  },
} as const;

const recommendationLandscapeItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['media', 'reason', 'score', 'rank', 'payload'],
  properties: {
    media: landscapeCardViewSchema,
    reason: nullableStringSchema,
    score: nullableNumberSchema,
    rank: { type: 'number' },
    payload: recordSchema,
  },
} as const;

const recommendationRegularSectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'layout', 'items', 'meta'],
  properties: {
    id: stringSchema,
    title: stringSchema,
    layout: { const: 'regular' },
    items: {
      type: 'array',
      items: recommendationRegularItemSchema,
    },
    meta: recordSchema,
  },
} as const;

const recommendationLandscapeSectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'layout', 'items', 'meta'],
  properties: {
    id: stringSchema,
    title: stringSchema,
    layout: { const: 'landscape' },
    items: {
      type: 'array',
      items: recommendationLandscapeItemSchema,
    },
    meta: recordSchema,
  },
} as const;

const recommendationCollectionSectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'layout', 'items', 'meta'],
  properties: {
    id: stringSchema,
    title: stringSchema,
    layout: { const: 'collection' },
    items: {
      type: 'array',
      items: collectionCardViewSchema,
    },
    meta: recordSchema,
  },
} as const;

const recommendationHeroSectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'layout', 'items', 'meta'],
  properties: {
    id: stringSchema,
    title: stringSchema,
    layout: { const: 'hero' },
    items: {
      type: 'array',
      items: heroCardViewSchema,
    },
    meta: recordSchema,
  },
} as const;

const recommendationSectionSchema = {
  anyOf: [
    recommendationRegularSectionSchema,
    recommendationLandscapeSectionSchema,
    recommendationCollectionSectionSchema,
    recommendationHeroSectionSchema,
  ],
} as const;

const profileHomeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'source', 'generatedAt', 'runtime', 'snapshot'],
  properties: {
    profileId: stringSchema,
    source: { const: 'canonical_home' },
    generatedAt: stringSchema,
    runtime: {
      type: 'object',
      additionalProperties: false,
      required: ['continueWatching', 'thisWeek'],
      properties: {
        continueWatching: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'layout', 'source', 'items'],
          properties: {
            id: { const: 'continue-watching' },
            title: { const: 'Continue Watching' },
            layout: { const: 'landscape' },
            source: { const: 'canonical_watch' },
            items: {
              type: 'array',
              items: continueWatchingItemSchema,
            },
          },
        },
        thisWeek: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'layout', 'source', 'items'],
          properties: {
            id: { const: 'this-week' },
            title: { const: 'This Week' },
            layout: { const: 'landscape' },
            source: { const: 'canonical_calendar' },
            items: {
              type: 'array',
              items: calendarItemSchema,
            },
          },
        },
      },
    },
    snapshot: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceKey', 'generatedAt', 'sections'],
      properties: {
        sourceKey: nullableStringSchema,
        generatedAt: nullableStringSchema,
        sections: {
          type: 'array',
          items: recommendationSectionSchema,
        },
      },
    },
  },
} as const;

export const profileHomeRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: profileHomeResponseSchema,
  },
});
