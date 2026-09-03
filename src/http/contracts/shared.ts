export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    category: 'validation' | 'authentication' | 'authorization' | 'not_found' | 'conflict' | 'idempotency' | 'rate_limit' | 'timeout' | 'upstream_dependency' | 'internal';
    retryable: boolean;
    requestId: string;
    details: unknown;
  };
};

export const responseMetaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId'],
  properties: {
    requestId: { type: 'string' },
    pageInfo: {
      type: 'object',
      additionalProperties: false,
      required: ['nextCursor', 'hasMore'],
      properties: {
        nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        hasMore: { type: 'boolean' },
      },
    },
  },
} as const;

export function successEnvelope<T extends Record<string, unknown>>(dataSchema: T) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'meta'],
    properties: {
      data: dataSchema,
      meta: responseMetaSchema,
    },
  } as const;
}

export function successListEnvelope<T extends Record<string, unknown>>(itemSchema: T) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'meta'],
    properties: {
      data: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: {
          items: { type: 'array', items: itemSchema },
        },
      },
      meta: responseMetaSchema,
    },
  } as const;
}

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'category', 'retryable', 'requestId', 'details'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        category: { type: 'string' },
        retryable: { type: 'boolean' },
        requestId: { type: 'string' },
        details: {},
      },
    },
  },
} as const;

export const stringSchema = {
  type: 'string',
} as const;

export const nonEmptyStringSchema = {
  type: 'string',
  minLength: 1,
} as const;

export const publicItemIdSchema = {
  type: 'string',
  pattern: '^[0-9a-f]{32}$',
  minLength: 32,
  maxLength: 32,
} as const;

export const nullablePublicItemIdSchema = {
  anyOf: [
    publicItemIdSchema,
    { type: 'null' },
  ],
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

export const profileIdAndItemIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'itemId'],
  properties: {
    profileId: nonEmptyStringSchema,
    itemId: publicItemIdSchema,
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

export const responsiveImageSetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['small', 'medium', 'large'],
  properties: {
    small: nullableStringSchema,
    medium: nullableStringSchema,
    large: nullableStringSchema,
  },
} as const;

export const mediaImageTagsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Primary', 'Backdrop', 'Logo', 'Thumb', 'Screenshot'],
  properties: {
    Primary: {
      anyOf: [responsiveImageSetSchema, { type: 'null' }],
    },
    Backdrop: {
      type: 'array',
      items: responsiveImageSetSchema,
    },
    Logo: {
      anyOf: [responsiveImageSetSchema, { type: 'null' }],
    },
    Thumb: {
      anyOf: [responsiveImageSetSchema, { type: 'null' }],
    },
    Screenshot: {
      type: 'array',
      items: responsiveImageSetSchema,
    },
  },
} as const;

export const parentMediaImageTagsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Primary', 'Backdrop', 'Logo', 'Thumb'],
  properties: {
    Primary: {
      anyOf: [responsiveImageSetSchema, { type: 'null' }],
    },
    Backdrop: {
      type: 'array',
      items: responsiveImageSetSchema,
    },
    Logo: {
      anyOf: [responsiveImageSetSchema, { type: 'null' }],
    },
    Thumb: {
      anyOf: [responsiveImageSetSchema, { type: 'null' }],
    },
  },
} as const;

export const providerIdsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Tmdb', 'Imdb', 'Tvdb'],
  properties: {
    Tmdb: nullableStringSchema,
    Imdb: nullableStringSchema,
    Tvdb: nullableStringSchema,
  },
} as const;

export const nullableParentMediaImageTagsSchema = {
  anyOf: [
    parentMediaImageTagsSchema,
    { type: 'null' },
  ],
} as const;

export const clientMediaTypeSchema = {
  type: 'string',
  enum: ['movie', 'tv', 'season', 'episode'],
} as const;

export const clientImageSetSchema = responsiveImageSetSchema;

export const clientImagesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['artwork', 'logo'],
  properties: {
    artwork: { anyOf: [responsiveImageSetSchema, { type: 'null' }] },
    logo: { anyOf: [responsiveImageSetSchema, { type: 'null' }] },
    still: { anyOf: [responsiveImageSetSchema, { type: 'null' }] },
  },
} as const;

export const clientProgressSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'played',
    'playCount',
    'positionSeconds',
    'durationSeconds',
    'percent',
    'lastPlayedAt',
    'watchlisted',
    'userRating',
  ],
  properties: {
    played: { type: 'boolean' },
    playCount: { type: 'integer', minimum: 0 },
    positionSeconds: { type: ['number', 'null'] },
    durationSeconds: { type: ['number', 'null'] },
    percent: { type: ['number', 'null'] },
    lastPlayedAt: { type: ['string', 'null'] },
    watchlisted: { type: 'boolean' },
    userRating: { type: ['number', 'null'] },
  },
} as const;

export const clientParentRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seriesItemId: { type: 'string' },
    seriesTitle: { type: 'string' },
    seasonItemId: { type: 'string' },
    seasonNumber: { type: ['integer', 'null'] },
    episodeNumber: { type: ['integer', 'null'] },
    images: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['artwork'],
          properties: {
            artwork: { anyOf: [responsiveImageSetSchema, { type: 'null' }] },
          },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

export const clientProviderIdsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tmdb', 'tvdb', 'imdb'],
  properties: {
    tmdb: { type: ['string', 'null'] },
    tvdb: { type: ['string', 'null'] },
    imdb: { type: ['string', 'null'] },
  },
} as const;

export const clientMediaCardSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'itemId',
    'mediaType',
    'title',
    'overview',
    'year',
    'releaseDate',
    'rating',
    'maturityRating',
    'genres',
    'runtimeSeconds',
    'images',
    'trailerUrl',
    'progress',
    'parent',
    'providerIds',
  ],
  properties: {
    itemId: publicItemIdSchema,
    mediaType: clientMediaTypeSchema,
    title: stringSchema,
    overview: { type: ['string', 'null'] },
    year: { type: ['integer', 'null'] },
    releaseDate: { type: ['string', 'null'] },
    rating: { type: ['number', 'null'] },
    maturityRating: { type: ['string', 'null'] },
    genres: { type: 'array', items: stringSchema },
    runtimeSeconds: { type: ['number', 'null'] },
    images: clientImagesSchema,
    trailerUrl: { type: ['string', 'null'] },
    progress: { anyOf: [clientProgressSchema, { type: 'null' }] },
    parent: { anyOf: [clientParentRefSchema, { type: 'null' }] },
    providerIds: { anyOf: [clientProviderIdsSchema, { type: 'null' }] },
  },
} as const;

export const clientMediaCardQueryResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Items', 'StartIndex', 'TotalRecordCount', 'NextCursor', 'HasMore'],
  properties: {
    Items: { type: 'array', items: clientMediaCardSchema },
    StartIndex: { type: 'integer' },
    TotalRecordCount: { type: 'integer' },
    NextCursor: { type: ['string', 'null'] },
    HasMore: { type: 'boolean' },
  },
} as const;

export const metadataArtworkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['artwork', 'still'],
  properties: {
    artwork: responsiveImageSetSchema,
    still: responsiveImageSetSchema,
  },
} as const;

export const metadataImagesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['artwork', 'still', 'logo'],
  properties: {
    artwork: responsiveImageSetSchema,
    still: responsiveImageSetSchema,
    logo: responsiveImageSetSchema,
  },
} as const;

export const mediaItemTypeSchema = {
  type: 'string',
  enum: ['movie', 'show', 'season', 'episode', 'unknown'],
} as const;

export const mediaExternalIdsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tmdb', 'imdb', 'tvdb'],
  properties: {
    tmdb: nullableIntegerSchema,
    imdb: nullableStringSchema,
    tvdb: nullableIntegerSchema,
  },
} as const;

export const mediaItemParentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId', 'mediaType', 'title'],
  properties: {
    itemId: publicItemIdSchema,
    mediaType: mediaItemTypeSchema,
    title: stringSchema,
  },
} as const;

export const nullableMediaItemParentSchema = {
  anyOf: [
    mediaItemParentSchema,
    { type: 'null' },
  ],
} as const;

export const mediaItemBadgeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'label'],
  properties: {
    kind: stringSchema,
    label: stringSchema,
  },
} as const;

export const mediaItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'itemId',
    'mediaType',
    'title',
    'originalTitle',
    'subtitle',
    'overview',
    'images',
    'releaseDate',
    'releaseYear',
    'rating',
    'genres',
    'runtimeMinutes',
    'status',
    'maturityRating',
    'certification',
    'trailerUrl',
    'trailerThumbnailUrl',
    'posterColor',
    'backdropColor',
    'externalIds',
    'parent',
    'showTmdbId',
    'seasonNumber',
    'episodeNumber',
    'absoluteEpisodeNumber',
    'episodeTitle',
    'airDate',
    'badges',
  ],
  properties: {
    itemId: publicItemIdSchema,
    mediaType: mediaItemTypeSchema,
    title: stringSchema,
    originalTitle: nullableStringSchema,
    subtitle: nullableStringSchema,
    overview: nullableStringSchema,
    images: metadataImagesSchema,
    releaseDate: nullableStringSchema,
    releaseYear: nullableIntegerSchema,
    rating: nullableNumberSchema,
    genres: {
      type: 'array',
      items: stringSchema,
    },
    runtimeMinutes: nullableIntegerSchema,
    status: nullableStringSchema,
    maturityRating: nullableStringSchema,
    certification: nullableStringSchema,
    trailerUrl: nullableStringSchema,
    trailerThumbnailUrl: nullableStringSchema,
    posterColor: nullableStringSchema,
    backdropColor: nullableStringSchema,
    externalIds: mediaExternalIdsSchema,
    parent: nullableMediaItemParentSchema,
    showTmdbId: nullableIntegerSchema,
    seasonNumber: nullableIntegerSchema,
    episodeNumber: nullableIntegerSchema,
    absoluteEpisodeNumber: nullableIntegerSchema,
    episodeTitle: nullableStringSchema,
    airDate: nullableStringSchema,
    badges: {
      type: 'array',
      items: mediaItemBadgeSchema,
    },
  },
} as const;

export const metadataCardViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'itemId',
    'mediaType',
    'kind',
    'parentMediaType',
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
    'maturityRating',
    'trailerUrl',
    'trailerThumbnailUrl',
    'posterColor',
    'backdropColor',
  ],
  properties: {
    itemId: publicItemIdSchema,
    mediaType: stringSchema,
    kind: stringSchema,
    parentMediaType: nullableStringSchema,
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
    maturityRating: nullableStringSchema,
    trailerUrl: nullableStringSchema,
    trailerThumbnailUrl: nullableStringSchema,
    posterColor: nullableStringSchema,
    backdropColor: nullableStringSchema,
  },
} as const;

export const regularCardViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mediaType', 'itemId', 'title', 'artwork', 'releaseYear', 'rating', 'genre', 'subtitle'],
  properties: {
    mediaType: stringSchema,
    itemId: publicItemIdSchema,
    title: stringSchema,
    artwork: responsiveImageSetSchema,
    releaseYear: nullableIntegerSchema,
    rating: nullableNumberSchema,
    genre: nullableStringSchema,
    subtitle: nullableStringSchema,
  },
} as const;

export const landscapeCardViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'mediaType',
    'itemId',
    'title',
    'artwork',
    'releaseYear',
    'rating',
    'genre',
    'seasonNumber',
    'episodeNumber',
    'episodeTitle',
    'airDate',
    'runtimeMinutes',
  ],
  properties: {
    mediaType: stringSchema,
    itemId: publicItemIdSchema,
    title: stringSchema,
    artwork: responsiveImageSetSchema,
    releaseYear: nullableIntegerSchema,
    rating: nullableNumberSchema,
    genre: nullableStringSchema,
    seasonNumber: nullableIntegerSchema,
    episodeNumber: nullableIntegerSchema,
    episodeTitle: nullableStringSchema,
    airDate: nullableStringSchema,
    runtimeMinutes: nullableIntegerSchema,
  },
} as const;

export const collectionCardItemViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mediaType', 'title', 'artwork', 'releaseYear', 'rating'],
  properties: {
    mediaType: stringSchema,
    title: stringSchema,
    artwork: responsiveImageSetSchema,
    releaseYear: nullableIntegerSchema,
    rating: nullableNumberSchema,
  },
} as const;

export const collectionCardViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'logo', 'items'],
  properties: {
    title: stringSchema,
    logo: responsiveImageSetSchema,
    items: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: collectionCardItemViewSchema,
    },
  },
} as const;

export const heroCardViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'itemId',
    'mediaType',
    'title',
    'description',
    'artwork',
    'logo',
    'releaseYear',
    'rating',
    'genre',
  ],
  properties: {
    itemId: publicItemIdSchema,
    mediaType: stringSchema,
    title: stringSchema,
    description: stringSchema,
    artwork: responsiveImageSetSchema,
    logo: responsiveImageSetSchema,
    releaseYear: nullableIntegerSchema,
    rating: nullableNumberSchema,
    genre: nullableStringSchema,
  },
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
