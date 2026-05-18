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
      items: baseItemDtoSchema,
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
