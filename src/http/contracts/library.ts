import {
  booleanSchema,
  nullableNumberSchema,
  nullableStringSchema,
  profileIdParamsSchema,
  regularCardViewSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type LibraryProfileParams = {
  profileId: string;
};

const providerAuthStateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'connected', 'status', 'externalUsername', 'statusMessage'],
  properties: {
    provider: stringSchema,
    connected: booleanSchema,
    status: stringSchema,
    externalUsername: nullableStringSchema,
    statusMessage: nullableStringSchema,
  },
} as const;

const libraryItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'media', 'state', 'origins'],
  properties: {
    id: stringSchema,
    media: regularCardViewSchema,
    state: {
      type: 'object',
      additionalProperties: false,
      required: ['addedAt', 'watchedAt', 'ratedAt', 'rating', 'lastActivityAt'],
      properties: {
        addedAt: nullableStringSchema,
        watchedAt: nullableStringSchema,
        ratedAt: nullableStringSchema,
        rating: nullableNumberSchema,
        lastActivityAt: nullableStringSchema,
      },
    },
    origins: {
      type: 'array',
      items: stringSchema,
    },
  },
} as const;

const librarySectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'order', 'itemCount', 'items'],
  properties: {
    id: stringSchema,
    label: stringSchema,
    order: { type: 'integer' },
    itemCount: { type: 'integer', minimum: 0 },
    items: {
      type: 'array',
      items: libraryItemSchema,
    },
  },
} as const;

const profileLibraryResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'source', 'generatedAt', 'auth', 'sections'],
  properties: {
    profileId: stringSchema,
    source: { const: 'canonical_library' },
    generatedAt: stringSchema,
    auth: {
      type: 'object',
      additionalProperties: false,
      required: ['providers'],
      properties: {
        providers: {
          type: 'array',
          items: providerAuthStateSchema,
        },
      },
    },
    sections: {
      type: 'array',
      items: librarySectionSchema,
    },
  },
} as const;

export const profileLibraryRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: profileLibraryResponseSchema,
  },
});
