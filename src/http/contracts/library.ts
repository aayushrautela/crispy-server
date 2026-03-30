import {
  booleanSchema,
  nullableNumberSchema,
  profileIdParamsSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export type LibraryProfileParams = {
  profileId: string;
};

const nullableStringSchema = {
  anyOf: [
    stringSchema,
    { type: 'null' },
  ],
} as const;

const metadataArtworkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['posterUrl', 'backdropUrl', 'stillUrl'],
  properties: {
    posterUrl: nullableStringSchema,
    backdropUrl: nullableStringSchema,
    stillUrl: nullableStringSchema,
  },
} as const;

const metadataImagesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['posterUrl', 'backdropUrl', 'stillUrl', 'logoUrl'],
  properties: {
    posterUrl: nullableStringSchema,
    backdropUrl: nullableStringSchema,
    stillUrl: nullableStringSchema,
    logoUrl: nullableStringSchema,
  },
} as const;

const metadataCardViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'mediaKey',
    'mediaType',
    'kind',
    'provider',
    'providerId',
    'parentMediaType',
    'parentProvider',
    'parentProviderId',
    'tmdbId',
    'showTmdbId',
    'seasonNumber',
    'episodeNumber',
    'absoluteEpisodeNumber',
    'title',
    'subtitle',
    'summary',
    'overview',
    'artwork',
    'images',
    'releaseDate',
    'releaseYear',
    'runtimeMinutes',
    'rating',
    'status',
  ],
  properties: {
    id: stringSchema,
    mediaKey: stringSchema,
    mediaType: stringSchema,
    kind: stringSchema,
    provider: stringSchema,
    providerId: stringSchema,
    parentMediaType: nullableStringSchema,
    parentProvider: nullableStringSchema,
    parentProviderId: nullableStringSchema,
    tmdbId: {
      anyOf: [
        { type: 'integer' },
        { type: 'null' },
      ],
    },
    showTmdbId: {
      anyOf: [
        { type: 'integer' },
        { type: 'null' },
      ],
    },
    seasonNumber: {
      anyOf: [
        { type: 'integer' },
        { type: 'null' },
      ],
    },
    episodeNumber: {
      anyOf: [
        { type: 'integer' },
        { type: 'null' },
      ],
    },
    absoluteEpisodeNumber: {
      anyOf: [
        { type: 'integer' },
        { type: 'null' },
      ],
    },
    title: nullableStringSchema,
    subtitle: nullableStringSchema,
    summary: nullableStringSchema,
    overview: nullableStringSchema,
    artwork: metadataArtworkSchema,
    images: metadataImagesSchema,
    releaseDate: nullableStringSchema,
    releaseYear: {
      anyOf: [
        { type: 'integer' },
        { type: 'null' },
      ],
    },
    runtimeMinutes: {
      anyOf: [
        { type: 'integer' },
        { type: 'null' },
      ],
    },
    rating: nullableNumberSchema,
    status: nullableStringSchema,
  },
} as const;

const detailsTargetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'mediaType'],
  properties: {
    id: stringSchema,
    mediaType: stringSchema,
  },
} as const;

const playbackTargetSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'contentId',
        'mediaType',
        'provider',
        'providerId',
        'parentProvider',
        'parentProviderId',
        'seasonNumber',
        'episodeNumber',
        'absoluteEpisodeNumber',
      ],
      properties: {
        contentId: nullableStringSchema,
        mediaType: stringSchema,
        provider: nullableStringSchema,
        providerId: nullableStringSchema,
        parentProvider: nullableStringSchema,
        parentProviderId: nullableStringSchema,
        seasonNumber: {
          anyOf: [
            { type: 'integer' },
            { type: 'null' },
          ],
        },
        episodeNumber: {
          anyOf: [
            { type: 'integer' },
            { type: 'null' },
          ],
        },
        absoluteEpisodeNumber: {
          anyOf: [
            { type: 'integer' },
            { type: 'null' },
          ],
        },
      },
    },
    { type: 'null' },
  ],
} as const;

const libraryItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'media', 'detailsTarget', 'playbackTarget', 'state', 'origins'],
  properties: {
    id: stringSchema,
    media: metadataCardViewSchema,
    detailsTarget: detailsTargetSchema,
    playbackTarget: playbackTargetSchema,
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
