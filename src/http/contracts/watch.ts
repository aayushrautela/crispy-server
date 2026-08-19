import {
  clientMediaCardQueryResultSchema,
  clientMediaCardSchema,
  nonEmptyStringSchema,
  nullableNumberSchema,
  positiveIntegerLikeSchema,
  profileIdAndItemIdParamsSchema,
  profileIdParamsSchema,
  publicItemIdSchema,
  recordSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';

export type WatchProfileParams = {
  profileId: string;
};

export type WatchContinueWatchingDismissParams = {
  profileId: string;
  id: string;
};

export type WatchPaginationQuery = {
  limit?: number | string;
  cursor?: string;
  itemId?: string;
  extended?: string;
};

export type WatchStateLookupContract = {
  itemId?: string;
  extended?: string;
};

export type WatchEventBody = {
  clientEventId?: string;
  eventType?: string;
  itemId?: string;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  rating?: number | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown>;
};

export type WatchMutationBody = {
  itemId?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  occurredAt?: string | null;
  rating?: number | null;
  payload?: Record<string, unknown>;
};

export type WatchStateBatchBody = {
  items?: WatchStateLookupContract[];
};

const watchListRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: positiveIntegerLikeSchema,
      cursor: stringSchema,
      itemId: publicItemIdSchema,
      extended: { type: 'string', enum: ['true', 'false'] },
    },
  },
});

export const watchEventsRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      clientEventId: stringSchema,
      eventType: stringSchema,
      itemId: publicItemIdSchema,
      positionSeconds: nullableNumberSchema,
      durationSeconds: nullableNumberSchema,
      seasonNumber: nullableNumberSchema,
      episodeNumber: nullableNumberSchema,
      rating: nullableNumberSchema,
      occurredAt: {
        anyOf: [
          stringSchema,
          { type: 'null' },
        ],
      },
      payload: recordSchema,
    },
  },
});

export const historyListRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: positiveIntegerLikeSchema,
      cursor: stringSchema,
      itemId: publicItemIdSchema,
      extended: { type: 'string', enum: ['true', 'false'] },
    },
  },
  response: {
    200: successEnvelope(clientMediaCardQueryResultSchema),
  },
});

export const continueWatchingListRouteSchema = withDefaultErrorResponses({
  ...watchListRouteSchema,
  response: {
    200: successEnvelope(clientMediaCardQueryResultSchema),
  },
});

export const watchlistListRouteSchema = withDefaultErrorResponses({
  ...watchListRouteSchema,
  response: {
    200: successEnvelope(clientMediaCardQueryResultSchema),
  },
});

export const nextUpListRouteSchema = withDefaultErrorResponses({
  ...watchListRouteSchema,
  response: {
    200: successEnvelope(clientMediaCardQueryResultSchema),
  },
});

export const ratingsListRouteSchema = withDefaultErrorResponses({
  ...watchListRouteSchema,
  response: {
    200: successEnvelope(clientMediaCardQueryResultSchema),
  },
});

export const watchContinueWatchingDismissRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['profileId', 'id'],
    properties: {
      profileId: nonEmptyStringSchema,
      id: publicItemIdSchema,
    },
  },
});

export const watchStateRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: {
      itemId: publicItemIdSchema,
      extended: { type: 'string', enum: ['true', 'false'] },
    },
  },
  response: {
    200: successEnvelope(clientMediaCardSchema),
  },
});

const clientMediaCardListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', items: clientMediaCardSchema },
  },
} as const;

export const watchStatesRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId'],
          properties: {
            itemId: publicItemIdSchema,
          },
        },
      },
    },
  },
  response: {
    200: successEnvelope(clientMediaCardListSchema),
  },
});

export const watchMutationRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      itemId: publicItemIdSchema,
      seasonNumber: nullableNumberSchema,
      episodeNumber: nullableNumberSchema,
      occurredAt: {
        anyOf: [
          stringSchema,
          { type: 'null' },
        ],
      },
      rating: nullableNumberSchema,
      payload: recordSchema,
    },
  },
});

export const watchItemIdMutationRouteSchema = withDefaultErrorResponses({
  params: profileIdAndItemIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      occurredAt: {
        anyOf: [
          stringSchema,
          { type: 'null' },
        ],
      },
      rating: nullableNumberSchema,
      payload: recordSchema,
    },
  },
});

export const watchItemIdParamsRouteSchema = withDefaultErrorResponses({
  params: profileIdAndItemIdParamsSchema,
});

export const watchStreamRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
});
