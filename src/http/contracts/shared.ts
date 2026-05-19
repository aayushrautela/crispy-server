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

export const baseItemDtoSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'Id', 'Type', 'Name', 'OriginalTitle', 'Overview', 'Taglines',
    'ProductionYear', 'PremiereDate', 'CommunityRating', 'OfficialRating',
    'Certification', 'Genres', 'RunTimeTicks', 'Status', 'ProviderIds',
    'ImageTags', 'ParentImageTags', 'SeriesId', 'SeriesName', 'SeasonId',
    'SeasonName', 'ParentIndexNumber', 'IndexNumber', 'AbsoluteIndexNumber',
    'EpisodeTitle', 'AirDate', 'RemoteTrailers', 'PosterColor', 'BackdropColor',
    'UserData',
  ],
  properties: {
    Id: publicItemIdSchema,
    Type: {
      type: 'string',
      enum: ['Movie', 'Series', 'Season', 'Episode', 'Unknown'],
    },
    Name: stringSchema,
    OriginalTitle: nullableStringSchema,
    Overview: nullableStringSchema,
    Taglines: {
      type: 'array',
      items: stringSchema,
    },
    ProductionYear: nullableIntegerSchema,
    PremiereDate: nullableStringSchema,
    CommunityRating: nullableNumberSchema,
    OfficialRating: nullableStringSchema,
    Certification: nullableStringSchema,
    Genres: {
      type: 'array',
      items: stringSchema,
    },
    RunTimeTicks: nullableIntegerSchema,
    Status: nullableStringSchema,
    ProviderIds: providerIdsSchema,
    ImageTags: mediaImageTagsSchema,
    ParentImageTags: nullableParentMediaImageTagsSchema,
    SeriesId: nullablePublicItemIdSchema,
    SeriesName: nullableStringSchema,
    SeasonId: nullablePublicItemIdSchema,
    SeasonName: nullableStringSchema,
    ParentIndexNumber: nullableIntegerSchema,
    IndexNumber: nullableIntegerSchema,
    AbsoluteIndexNumber: nullableIntegerSchema,
    EpisodeTitle: nullableStringSchema,
    AirDate: nullableStringSchema,
    RemoteTrailers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['Name', 'Url', 'ThumbnailUrl'],
        properties: {
          Name: nullableStringSchema,
          Url: stringSchema,
          ThumbnailUrl: nullableStringSchema,
        },
      },
    },
    PosterColor: nullableStringSchema,
    BackdropColor: nullableStringSchema,
    UserData: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            'ItemId', 'IsFavorite', 'Played', 'PlayCount',
            'PlaybackPositionTicks', 'RuntimeTicks', 'PlayedPercentage',
            'LastPlayedDate', 'Rating', 'DismissedFromContinueWatching',
          ],
          properties: {
            ItemId: nullablePublicItemIdSchema,
            IsFavorite: { type: 'boolean' },
            Played: { type: 'boolean' },
            PlayCount: { type: 'number' },
            PlaybackPositionTicks: nullableNumberSchema,
            RuntimeTicks: nullableNumberSchema,
            PlayedPercentage: nullableNumberSchema,
            LastPlayedDate: nullableStringSchema,
            Rating: nullableNumberSchema,
            DismissedFromContinueWatching: { type: 'boolean' },
          },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

export const nullableBaseItemDtoSchema = {
  anyOf: [
    baseItemDtoSchema,
    { type: 'null' },
  ],
} as const;

export const baseItemDtoQueryResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Items', 'StartIndex', 'TotalRecordCount', 'NextCursor', 'HasMore'],
  properties: {
    Items: { type: 'array', items: baseItemDtoSchema },
    StartIndex: { type: 'integer' },
    TotalRecordCount: { type: 'integer' },
    NextCursor: { type: ['string', 'null'] },
    HasMore: { type: 'boolean' },
  },
} as const;

export const metadataArtworkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['poster', 'backdrop', 'still'],
  properties: {
    poster: responsiveImageSetSchema,
    backdrop: responsiveImageSetSchema,
    still: responsiveImageSetSchema,
  },
} as const;

export const metadataImagesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['poster', 'backdrop', 'still', 'logo'],
  properties: {
    poster: responsiveImageSetSchema,
    backdrop: responsiveImageSetSchema,
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
  required: ['mediaKey', 'mediaType', 'title'],
  properties: {
    mediaKey: stringSchema,
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
    'mediaKey',
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
    mediaKey: stringSchema,
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
    'mediaKey',
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
    mediaKey: stringSchema,
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
  required: ['mediaType', 'mediaKey', 'title', 'poster', 'releaseYear', 'rating', 'genre', 'subtitle'],
  properties: {
    mediaType: stringSchema,
    mediaKey: stringSchema,
    title: stringSchema,
    poster: responsiveImageSetSchema,
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
    'mediaKey',
    'title',
    'poster',
    'backdrop',
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
    mediaKey: stringSchema,
    title: stringSchema,
    poster: responsiveImageSetSchema,
    backdrop: responsiveImageSetSchema,
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
  required: ['mediaType', 'title', 'poster', 'releaseYear', 'rating'],
  properties: {
    mediaType: stringSchema,
    title: stringSchema,
    poster: responsiveImageSetSchema,
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
    'mediaKey',
    'mediaType',
    'title',
    'description',
    'backdrop',
    'poster',
    'logo',
    'releaseYear',
    'rating',
    'genre',
  ],
  properties: {
    mediaKey: stringSchema,
    mediaType: stringSchema,
    title: stringSchema,
    description: stringSchema,
    backdrop: responsiveImageSetSchema,
    poster: responsiveImageSetSchema,
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
