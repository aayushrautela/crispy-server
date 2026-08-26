import {
  clientImagesSchema,
  clientMediaTypeSchema,
  clientParentRefSchema,
  clientProgressSchema,
  clientProviderIdsSchema,
  nullableIntegerSchema,
  nullableNumberSchema,
  nullableStringSchema,
  profileIdParamsSchema,
  publicItemIdSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';

export type CalendarProfileParams = {
  profileId: string;
};

export const calendarItemBucketSchema = {
  type: 'string',
  enum: ['up_next', 'this_week', 'upcoming', 'recently_released', 'no_scheduled'],
} as const;

/**
 * Calendar items reuse the standardized `ClientMediaCard` shape (same enriched
 * card contract as watch/recommendation surfaces) extended with the
 * calendar-specific `airDate` and `bucket` fields.
 */
const calendarItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'itemId', 'mediaType', 'title', 'overview', 'year',
    'releaseDate', 'rating', 'maturityRating', 'genres', 'runtimeSeconds',
    'images', 'trailerUrl', 'progress', 'parent', 'providerIds',
    'airDate', 'bucket',
  ],
  properties: {
    itemId: publicItemIdSchema,
    mediaType: clientMediaTypeSchema,
    title: stringSchema,
    overview: nullableStringSchema,
    year: nullableIntegerSchema,
    releaseDate: nullableStringSchema,
    rating: nullableNumberSchema,
    maturityRating: nullableStringSchema,
    genres: {
      type: 'array',
      items: stringSchema,
    },
    runtimeSeconds: nullableNumberSchema,
    images: clientImagesSchema,
    trailerUrl: nullableStringSchema,
    progress: {
      anyOf: [clientProgressSchema, { type: 'null' }],
    },
    parent: {
      anyOf: [clientParentRefSchema, { type: 'null' }],
    },
    providerIds: {
      anyOf: [clientProviderIdsSchema, { type: 'null' }],
    },
    airDate: nullableStringSchema,
    bucket: calendarItemBucketSchema,
  },
} as const;

const profileCalendarBaseResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'source', 'generatedAt', 'items'],
  properties: {
    profileId: stringSchema,
    source: { const: 'canonical_calendar' },
    generatedAt: stringSchema,
    items: {
      type: 'array',
      items: calendarItemSchema,
    },
  },
} as const;

const profileCalendarResponseSchema = {
  ...profileCalendarBaseResponseSchema,
} as const;

const profileThisWeekResponseSchema = {
  ...profileCalendarBaseResponseSchema,
} as const;

export const profileCalendarRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: successEnvelope(profileCalendarResponseSchema),
  },
});

export const profileThisWeekRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: successEnvelope(profileThisWeekResponseSchema),
  },
});
