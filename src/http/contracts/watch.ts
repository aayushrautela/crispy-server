import {
  nonEmptyStringSchema,
  nullableNumberSchema,
  positiveIntegerLikeSchema,
  profileIdAndMediaKeyParamsSchema,
  profileIdParamsSchema,
  recordSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type WatchProfileParams = {
  profileId: string;
};

export type WatchContinueWatchingDismissParams = {
  profileId: string;
  id: string;
};

export type WatchMediaKeyParams = {
  profileId: string;
  mediaKey: string;
};

export type WatchPaginationQuery = {
  limit?: number | string;
};

export type WatchStateLookupContract = {
  mediaKey?: string;
};

export type WatchEventBody = {
  clientEventId?: string;
  eventType?: string;
  mediaKey?: string;
  mediaType?: string;
  provider?: string;
  providerId?: string;
  parentProvider?: string;
  parentProviderId?: string;
  seasonNumber?: number | string | null;
  episodeNumber?: number | string | null;
  absoluteEpisodeNumber?: number | string | null;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  rating?: number | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown>;
};

export type WatchMutationBody = {
  mediaKey?: string;
  mediaType?: string;
  provider?: string;
  providerId?: string;
  parentProvider?: string;
  parentProviderId?: string;
  seasonNumber?: number | string | null;
  episodeNumber?: number | string | null;
  absoluteEpisodeNumber?: number | string | null;
  occurredAt?: string | null;
  rating?: number | null;
  payload?: Record<string, unknown>;
};

export type WatchStateBatchBody = {
  items?: WatchStateLookupContract[];
};

export const watchEventsRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      clientEventId: stringSchema,
      eventType: stringSchema,
      mediaKey: stringSchema,
      mediaType: stringSchema,
      provider: stringSchema,
      providerId: stringSchema,
      parentProvider: stringSchema,
      parentProviderId: stringSchema,
      seasonNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
      episodeNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
      absoluteEpisodeNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
      positionSeconds: nullableNumberSchema,
      durationSeconds: nullableNumberSchema,
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

export const watchListRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: positiveIntegerLikeSchema,
    },
  },
});

export const watchContinueWatchingDismissRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['profileId', 'id'],
    properties: {
      profileId: nonEmptyStringSchema,
      id: nonEmptyStringSchema,
    },
  },
});

export const watchStateRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    required: ['mediaKey'],
    properties: {
      mediaKey: stringSchema,
    },
  },
});

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
          required: ['mediaKey'],
          properties: {
            mediaKey: stringSchema,
          },
        },
      },
    },
  },
});

export const watchMutationRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      mediaKey: stringSchema,
      mediaType: stringSchema,
      provider: stringSchema,
      providerId: stringSchema,
      parentProvider: stringSchema,
      parentProviderId: stringSchema,
      seasonNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
      episodeNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
      absoluteEpisodeNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
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

export const watchMediaKeyMutationRouteSchema = withDefaultErrorResponses({
  params: profileIdAndMediaKeyParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      mediaKey: stringSchema,
      mediaType: stringSchema,
      provider: stringSchema,
      providerId: stringSchema,
      parentProvider: stringSchema,
      parentProviderId: stringSchema,
      seasonNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
      episodeNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
      absoluteEpisodeNumber: {
        anyOf: [
          positiveIntegerLikeSchema,
          { type: 'null' },
        ],
      },
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

export const watchMediaKeyParamsRouteSchema = withDefaultErrorResponses({
  params: profileIdAndMediaKeyParamsSchema,
});
