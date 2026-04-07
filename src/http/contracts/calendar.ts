import {
  booleanSchema,
  landscapeCardViewSchema,
  nullableStringSchema,
  profileIdParamsSchema,
  regularCardViewSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type CalendarProfileParams = {
  profileId: string;
};

export const calendarItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['bucket', 'media', 'relatedShow', 'airDate', 'watched'],
  properties: {
    bucket: {
      enum: ['up_next', 'this_week', 'upcoming', 'recently_released', 'no_scheduled'],
    },
    media: landscapeCardViewSchema,
    relatedShow: regularCardViewSchema,
    airDate: nullableStringSchema,
    watched: booleanSchema,
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
  required: ['profileId', 'source', 'kind', 'generatedAt', 'items'],
  properties: {
    ...profileCalendarBaseResponseSchema.properties,
    kind: { const: 'this-week' },
  },
} as const;

export const profileCalendarRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: profileCalendarResponseSchema,
  },
});

export const profileThisWeekRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: profileThisWeekResponseSchema,
  },
});
