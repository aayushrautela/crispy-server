import {
  landscapeCardViewSchema,
  nonEmptyStringSchema,
  nullableNumberSchema,
  nullableStringSchema,
  positiveIntegerLikeSchema,
  profileIdAndMediaKeyParamsSchema,
  profileIdParamsSchema,
  regularCardViewSchema,
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

const continueWatchingItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'media',
    'progress',
    'watchedAt',
    'lastActivityAt',
    'origins',
    'dismissible',
  ],
  properties: {
    id: stringSchema,
    media: landscapeCardViewSchema,
    progress: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['positionSeconds', 'durationSeconds', 'progressPercent', 'lastPlayedAt'],
          properties: {
            positionSeconds: nullableNumberSchema,
            durationSeconds: nullableNumberSchema,
            progressPercent: { type: 'number' },
            lastPlayedAt: nullableStringSchema,
          },
        },
        { type: 'null' },
      ],
    },
    watchedAt: nullableStringSchema,
    lastActivityAt: stringSchema,
    origins: {
      type: 'array',
      items: stringSchema,
    },
    dismissible: { type: 'boolean' },
  },
} as const;

const watchProductItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['media'],
  properties: {
    media: regularCardViewSchema,
  },
} as const;

const watchedItemSchema = {
  ...watchProductItemSchema,
  required: [...watchProductItemSchema.required, 'watchedAt', 'origins'],
  properties: {
    ...watchProductItemSchema.properties,
    watchedAt: stringSchema,
    origins: {
      type: 'array',
      items: stringSchema,
    },
  },
} as const;

const watchlistItemSchema = {
  ...watchProductItemSchema,
  required: [...watchProductItemSchema.required, 'addedAt', 'origins'],
  properties: {
    ...watchProductItemSchema.properties,
    addedAt: stringSchema,
    origins: {
      type: 'array',
      items: stringSchema,
    },
  },
} as const;

const ratingItemSchema = {
  ...watchProductItemSchema,
  required: [...watchProductItemSchema.required, 'rating', 'origins'],
  properties: {
    ...watchProductItemSchema.properties,
    rating: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'ratedAt'],
      properties: {
        value: { type: 'number' },
        ratedAt: stringSchema,
      },
    },
    origins: {
      type: 'array',
      items: stringSchema,
    },
  },
} as const;

function buildWatchCollectionResponseSchema(kind: 'continue-watching' | 'watched' | 'watchlist' | 'ratings', itemSchema: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['profileId', 'kind', 'source', 'generatedAt', 'items'],
    properties: {
      profileId: stringSchema,
      kind: { const: kind },
      source: { const: 'canonical_watch' },
      generatedAt: stringSchema,
      items: {
        type: 'array',
        items: itemSchema,
      },
    },
  } as const;
}

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

export const continueWatchingListRouteSchema = withDefaultErrorResponses({
  ...watchListRouteSchema,
  response: {
    200: buildWatchCollectionResponseSchema('continue-watching', continueWatchingItemSchema),
  },
});

export const watchedListRouteSchema = withDefaultErrorResponses({
  ...watchListRouteSchema,
  response: {
    200: buildWatchCollectionResponseSchema('watched', watchedItemSchema),
  },
});

export const watchlistListRouteSchema = withDefaultErrorResponses({
  ...watchListRouteSchema,
  response: {
    200: buildWatchCollectionResponseSchema('watchlist', watchlistItemSchema),
  },
});

export const ratingsListRouteSchema = withDefaultErrorResponses({
  ...watchListRouteSchema,
  response: {
    200: buildWatchCollectionResponseSchema('ratings', ratingItemSchema),
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
