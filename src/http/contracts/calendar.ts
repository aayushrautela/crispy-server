import {
  booleanSchema,
  mediaItemDtoSchema,
  nullableMediaPresentationHintSchema,
  nullableStringSchema,
  profileIdParamsSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';

export type CalendarProfileParams = {
  profileId: string;
};

export const calendarItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['bucket', 'kind', 'mediaItem', 'context', 'presentation', 'airDate', 'watched'],
  properties: {
    bucket: {
      enum: ['up_next', 'this_week', 'upcoming', 'recently_released', 'no_scheduled'],
    },
    kind: { const: 'calendar_item' },
    mediaItem: mediaItemDtoSchema,
    context: {
      type: 'object',
      additionalProperties: false,
      required: ['bucket', 'airDate', 'watched', 'relatedShow'],
      properties: {
        bucket: {
          enum: ['up_next', 'this_week', 'upcoming', 'recently_released', 'no_scheduled'],
        },
        airDate: nullableStringSchema,
        watched: booleanSchema,
        relatedShow: mediaItemDtoSchema,
      },
    },
    presentation: nullableMediaPresentationHintSchema,
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
    200: successEnvelope(profileCalendarResponseSchema),
  },
});

export const profileThisWeekRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: successEnvelope(profileThisWeekResponseSchema),
  },
});
