import {
  booleanSchema,
  nonEmptyStringSchema,
  nullableNumberSchema,
  nullableStringSchema,
  positiveIntegerLikeSchema,
  profileIdParamsSchema,
  regularCardViewSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type LibraryProfileParams = {
  profileId: string;
};

export type LibrarySectionParams = {
  profileId: string;
  sectionId: string;
};

export type LibrarySectionQuery = {
  limit?: number | string;
  cursor?: string;
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
  required: ['id', 'label', 'order'],
  properties: {
    id: stringSchema,
    label: stringSchema,
    order: { type: 'integer' },
  },
} as const;

const librarySectionSummarySchema = {
  ...librarySectionSchema,
  required: [...librarySectionSchema.required, 'itemCount'],
  properties: {
    ...librarySectionSchema.properties,
    itemCount: { type: 'integer', minimum: 0 },
  },
} as const;

const librarySectionPageInfoSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nextCursor', 'hasMore'],
  properties: {
    nextCursor: nullableStringSchema,
    hasMore: booleanSchema,
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
      items: librarySectionSummarySchema,
    },
  },
} as const;

export const profileLibraryRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  response: {
    200: profileLibraryResponseSchema,
  },
});

export const profileLibrarySectionRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['profileId', 'sectionId'],
    properties: {
      profileId: nonEmptyStringSchema,
      sectionId: nonEmptyStringSchema,
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: positiveIntegerLikeSchema,
      cursor: stringSchema,
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['profileId', 'source', 'generatedAt', 'section', 'items', 'pageInfo'],
      properties: {
        profileId: stringSchema,
        source: { const: 'canonical_library' },
        generatedAt: stringSchema,
        section: librarySectionSchema,
        items: {
          type: 'array',
          items: libraryItemSchema,
        },
        pageInfo: librarySectionPageInfoSchema,
      },
    },
  },
});
