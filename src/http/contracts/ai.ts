import {
  nonEmptyStringSchema,
  nullableNumberSchema,
  profileIdParamsSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

const nullableStringSchema = {
  anyOf: [
    stringSchema,
    { type: 'null' },
  ],
} as const;

const nullableIntegerSchema = {
  anyOf: [
    { type: 'integer' },
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

const aiSearchItemSchema = {
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
    id: nonEmptyStringSchema,
    mediaKey: nonEmptyStringSchema,
    mediaType: { type: 'string', enum: ['movie', 'show', 'anime'] },
    kind: { type: 'string', enum: ['title'] },
    provider: nonEmptyStringSchema,
    providerId: nonEmptyStringSchema,
    parentMediaType: { anyOf: [{ type: 'null' }] },
    parentProvider: { anyOf: [{ type: 'null' }] },
    parentProviderId: { anyOf: [{ type: 'null' }] },
    tmdbId: nullableIntegerSchema,
    showTmdbId: nullableIntegerSchema,
    seasonNumber: nullableIntegerSchema,
    episodeNumber: nullableIntegerSchema,
    absoluteEpisodeNumber: nullableIntegerSchema,
    title: nullableStringSchema,
    subtitle: nullableStringSchema,
    summary: nullableStringSchema,
    overview: nullableStringSchema,
    artwork: metadataArtworkSchema,
    images: metadataImagesSchema,
    releaseDate: nullableStringSchema,
    releaseYear: nullableIntegerSchema,
    runtimeMinutes: nullableIntegerSchema,
    rating: nullableNumberSchema,
    status: nullableStringSchema,
  },
} as const;

export const aiSearchRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: stringSchema,
      filter: stringSchema,
      locale: stringSchema,
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: aiSearchItemSchema,
        },
      },
    },
  },
});

export const aiInsightsRouteSchema = withDefaultErrorResponses({
  params: profileIdParamsSchema,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['contentId'],
    properties: {
      contentId: nonEmptyStringSchema,
      locale: stringSchema,
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['insights', 'trivia'],
      properties: {
        insights: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['category', 'title', 'content', 'type'],
            properties: {
              category: nonEmptyStringSchema,
              title: nonEmptyStringSchema,
              content: nonEmptyStringSchema,
              type: nonEmptyStringSchema,
            },
          },
        },
        trivia: stringSchema,
      },
    },
  },
});
