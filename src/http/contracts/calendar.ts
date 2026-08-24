import {
  baseItemDtoSchema,
  profileIdParamsSchema,
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

const calendarItemSchema = {
  ...baseItemDtoSchema,
  required: [...baseItemDtoSchema.required, 'bucket'],
  properties: {
    ...baseItemDtoSchema.properties,
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
