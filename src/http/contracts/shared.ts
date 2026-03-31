export type ApiErrorResponse = {
  code: string;
  message: string;
  details?: unknown;
};

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    details: {},
  },
} as const;

export const stringSchema = {
  type: 'string',
} as const;

export const nonEmptyStringSchema = {
  type: 'string',
  minLength: 1,
} as const;

export const integerLikeSchema = {
  anyOf: [
    { type: 'integer' },
    { type: 'string', pattern: '^-?\\d+$' },
  ],
} as const;

export const positiveIntegerLikeSchema = {
  anyOf: [
    { type: 'integer', minimum: 1 },
    { type: 'string', pattern: '^[1-9]\\d*$' },
  ],
} as const;

export const booleanSchema = {
  type: 'boolean',
} as const;

export const numberSchema = {
  type: 'number',
} as const;

export const nullableNumberSchema = {
  anyOf: [
    { type: 'number' },
    { type: 'null' },
  ],
} as const;

export const nullableIntegerLikeSchema = {
  anyOf: [
    integerLikeSchema,
    { type: 'null' },
  ],
} as const;

export const nullablePositiveIntegerLikeSchema = {
  anyOf: [
    positiveIntegerLikeSchema,
    { type: 'null' },
  ],
} as const;

export const recordSchema = {
  type: 'object',
  additionalProperties: true,
} as const;

export const stringListSchema = {
  anyOf: [
    stringSchema,
    {
      type: 'array',
      items: stringSchema,
    },
  ],
} as const;

export const profileIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId'],
  properties: {
    profileId: nonEmptyStringSchema,
  },
} as const;

export const profileIdAndMediaKeyParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'mediaKey'],
  properties: {
    profileId: nonEmptyStringSchema,
    mediaKey: nonEmptyStringSchema,
  },
} as const;

type RouteSchema = Record<string, unknown> & {
  response?: Record<number, unknown>;
};

const defaultErrorResponseSchemas: Record<number, unknown> = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  412: errorResponseSchema,
  422: errorResponseSchema,
  500: errorResponseSchema,
  502: errorResponseSchema,
  503: errorResponseSchema,
};

export const nullableStringSchema = {
  anyOf: [
    stringSchema,
    { type: 'null' },
  ],
} as const;

export const nullableIntegerSchema = {
  anyOf: [
    { type: 'integer' },
    { type: 'null' },
  ],
} as const;

export const metadataArtworkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['posterUrl', 'backdropUrl', 'stillUrl'],
  properties: {
    posterUrl: nullableStringSchema,
    backdropUrl: nullableStringSchema,
    stillUrl: nullableStringSchema,
  },
} as const;

export const metadataImagesSchema = {
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

export const metadataCardViewSchema = {
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

export const detailsTargetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'titleId', 'titleMediaType', 'highlightEpisodeId'],
  properties: {
    kind: { const: 'title' },
    titleId: stringSchema,
    titleMediaType: stringSchema,
    highlightEpisodeId: nullableStringSchema,
  },
} as const;

export const playbackTargetSchema = {
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
        seasonNumber: nullableIntegerSchema,
        episodeNumber: nullableIntegerSchema,
        absoluteEpisodeNumber: nullableIntegerSchema,
      },
    },
    { type: 'null' },
  ],
} as const;

export const episodeContextSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'episodeId',
        'seasonNumber',
        'episodeNumber',
        'absoluteEpisodeNumber',
        'title',
        'airDate',
        'runtimeMinutes',
        'stillUrl',
        'overview',
      ],
      properties: {
        episodeId: stringSchema,
        seasonNumber: nullableIntegerSchema,
        episodeNumber: nullableIntegerSchema,
        absoluteEpisodeNumber: nullableIntegerSchema,
        title: nullableStringSchema,
        airDate: nullableStringSchema,
        runtimeMinutes: nullableIntegerSchema,
        stillUrl: nullableStringSchema,
        overview: nullableStringSchema,
      },
    },
    { type: 'null' },
  ],
} as const;

export function withDefaultErrorResponses<T extends RouteSchema>(schema: T): T & { response: Record<number, unknown> } {
  return {
    ...schema,
    response: {
      ...defaultErrorResponseSchemas,
      ...(schema.response ?? {}),
    },
  };
}
