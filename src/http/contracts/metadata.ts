import {
  baseItemDtoQueryResultSchema,
  baseItemDtoSchema,
  booleanSchema,
  nullableIntegerSchema,
  nullableNumberSchema,
  nullableStringSchema,
  positiveIntegerLikeSchema,
  profileIdAndItemIdParamsSchema,
  publicItemIdSchema,
  responsiveImageSetSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';

export type MetadataResolveQuery = {
  itemId: string;
  language?: string;
};

export type MetadataPlaybackResolveQuery = {
  itemId: string;
  language?: string;
};

export type MetadataItemParams = {
  itemId: string;
};

export type MetadataPersonParams = {
  personId: string;
};

export type MetadataPersonQuery = {
  language?: string;
};

export type MetadataSearchQuery = {
  query?: string;
  genre?: string;
  filter?: string;
  limit?: number | string;
  locale?: string;
};

export type MetadataSearchSuggestionsQuery = {
  query?: string;
  filter?: string;
  limit?: number | string;
  locale?: string;
};

export type MetadataCardsBatchBody = {
  itemIds?: string[];
  language?: string;
};

const metadataResolveQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId'],
  properties: {
    itemId: publicItemIdSchema,
    language: stringSchema,
  },
} as const;

const metadataLanguageQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: stringSchema,
  },
} as const;

const metadataItemParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId'],
  properties: {
    itemId: publicItemIdSchema,
  },
} as const;

const metadataPersonParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['personId'],
  properties: {
    personId: publicItemIdSchema,
  },
} as const;

const playbackResolveQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId'],
  properties: {
    itemId: publicItemIdSchema,
    language: stringSchema,
  },
} as const;

const metadataVideoViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'key', 'name', 'site', 'type', 'official', 'publishedAt', 'url', 'thumbnailUrl'],
  properties: {
    id: stringSchema,
    key: stringSchema,
    name: nullableStringSchema,
    site: nullableStringSchema,
    type: nullableStringSchema,
    official: booleanSchema,
    publishedAt: nullableStringSchema,
    url: nullableStringSchema,
    thumbnailUrl: nullableStringSchema,
  },
} as const;

const metadataPersonRefViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['personId', 'name', 'role', 'department', 'profileUrl'],
  properties: {
    personId: publicItemIdSchema,
    name: stringSchema,
    role: nullableStringSchema,
    department: nullableStringSchema,
    profileUrl: nullableStringSchema,
  },
} as const;

const metadataReviewViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'author', 'username', 'content', 'createdAt', 'updatedAt', 'url', 'rating', 'avatarUrl'],
  properties: {
    id: stringSchema,
    provider: stringSchema,
    author: nullableStringSchema,
    username: nullableStringSchema,
    content: stringSchema,
    createdAt: nullableStringSchema,
    updatedAt: nullableStringSchema,
    url: nullableStringSchema,
    rating: nullableNumberSchema,
    avatarUrl: nullableStringSchema,
  },
} as const;

const stringOrIntegerSchema = {
  anyOf: [
    { type: 'integer' },
    stringSchema,
  ],
} as const;

const metadataCompanyViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'providerId', 'name', 'logo', 'originCountry'],
  properties: {
    id: stringOrIntegerSchema,
    provider: stringSchema,
    providerId: stringSchema,
    name: stringSchema,
    logo: responsiveImageSetSchema,
    originCountry: nullableStringSchema,
  },
} as const;

const metadataProductionInfoViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['originalLanguage', 'originCountries', 'spokenLanguages', 'productionCountries', 'companies', 'networks'],
  properties: {
    originalLanguage: nullableStringSchema,
    originCountries: { type: 'array', items: stringSchema },
    spokenLanguages: { type: 'array', items: stringSchema },
    productionCountries: { type: 'array', items: stringSchema },
    companies: { type: 'array', items: metadataCompanyViewSchema },
    networks: { type: 'array', items: metadataCompanyViewSchema },
  },
} as const;

const metadataTitleDetailResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Item', 'NextEpisode', 'Videos', 'Cast', 'Directors', 'Creators', 'Production'],
  properties: {
    Item: baseItemDtoSchema,
    NextEpisode: {
      anyOf: [
        baseItemDtoSchema,
        { type: 'null' },
      ],
    },
    Videos: { type: 'array', items: metadataVideoViewSchema },
    Cast: { type: 'array', items: metadataPersonRefViewSchema },
    Directors: { type: 'array', items: metadataPersonRefViewSchema },
    Creators: { type: 'array', items: metadataPersonRefViewSchema },
    Production: metadataProductionInfoViewSchema,
  },
} as const;

const metadataTitleRatingsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Ratings'],
  properties: {
    Ratings: {
      type: 'object',
      additionalProperties: false,
      required: ['imdb', 'tmdb', 'trakt', 'metacritic', 'rottenTomatoes', 'audience', 'letterboxd', 'rogerEbert'],
      properties: {
        imdb: nullableNumberSchema,
        tmdb: nullableNumberSchema,
        trakt: nullableNumberSchema,
        metacritic: nullableNumberSchema,
        rottenTomatoes: nullableNumberSchema,
        audience: nullableNumberSchema,
        letterboxd: nullableNumberSchema,
        rogerEbert: nullableNumberSchema,
      },
    },
  },
} as const;

const metadataResolveResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Item'],
  properties: {
    Item: baseItemDtoSchema,
  },
} as const;

const metadataPersonKnownForItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mediaType', 'itemId', 'title', 'poster', 'rating', 'releaseYear'],
  properties: {
    mediaType: stringSchema,
    itemId: publicItemIdSchema,
    title: stringSchema,
    poster: responsiveImageSetSchema,
    rating: nullableNumberSchema,
    releaseYear: nullableIntegerSchema,
  },
} as const;

const metadataPersonDetailResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['personId', 'name', 'knownForDepartment', 'biography', 'birthday', 'placeOfBirth', 'profileUrl', 'knownFor'],
  properties: {
    personId: publicItemIdSchema,
    name: stringSchema,
    knownForDepartment: nullableStringSchema,
    biography: nullableStringSchema,
    birthday: nullableStringSchema,
    placeOfBirth: nullableStringSchema,
    profileUrl: nullableStringSchema,
    knownFor: { type: 'array', items: metadataPersonKnownForItemSchema },
  },
} as const;

const playbackResolveResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Item', 'Show', 'Season'],
  properties: {
    Item: baseItemDtoSchema,
    Show: {
      anyOf: [
        baseItemDtoSchema,
        { type: 'null' },
      ],
    },
    Season: {
      anyOf: [
        baseItemDtoSchema,
        { type: 'null' },
      ],
    },
  },
} as const;

export const metadataPersonSearchResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'personId', 'name', 'knownForDepartment', 'profileUrl', 'knownForTitles'],
  properties: {
    kind: { const: 'person_search_result' },
    personId: publicItemIdSchema,
    name: stringSchema,
    knownForDepartment: nullableStringSchema,
    profileUrl: nullableStringSchema,
    knownForTitles: { type: 'array', items: stringSchema },
  },
} as const;

const metadataSearchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'all', 'movies', 'series', 'people'],
  properties: {
    query: stringSchema,
    all: {
      type: 'array',
      items: baseItemDtoSchema,
    },
    movies: {
      type: 'array',
      items: baseItemDtoSchema,
    },
    series: {
      type: 'array',
      items: baseItemDtoSchema,
    },
    people: {
      type: 'array',
      items: metadataPersonSearchResultSchema,
    },
  },
} as const;

const metadataCardsBatchBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['itemIds'],
  properties: {
    itemIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: publicItemIdSchema,
    },
    language: stringSchema,
  },
} as const;

const metadataCardsBatchResponseSchema = baseItemDtoQueryResultSchema;

export const metadataResolveRouteSchema = withDefaultErrorResponses({
  querystring: metadataResolveQuerystringSchema,
  response: {
    200: successEnvelope(metadataResolveResponseSchema),
  },
});

export const metadataItemDetailRouteSchema = withDefaultErrorResponses({
  params: metadataItemParamsSchema,
  querystring: metadataLanguageQuerystringSchema,
  response: {
    200: successEnvelope(metadataTitleDetailResponseSchema),
  },
});

export const metadataItemRatingsRouteSchema = withDefaultErrorResponses({
  params: profileIdAndItemIdParamsSchema,
  response: {
    200: successEnvelope(metadataTitleRatingsResponseSchema),
  },
});

export const metadataPersonRouteSchema = withDefaultErrorResponses({
  params: metadataPersonParamsSchema,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      language: stringSchema,
    },
  },
  response: {
    200: successEnvelope(metadataPersonDetailResponseSchema),
  },
});

export const playbackResolveRouteSchema = withDefaultErrorResponses({
  querystring: playbackResolveQuerystringSchema,
  response: {
    200: successEnvelope(playbackResolveResponseSchema),
  },
});

export const metadataSearchRouteSchema = withDefaultErrorResponses({
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: stringSchema,
      genre: stringSchema,
      filter: stringSchema,
      limit: positiveIntegerLikeSchema,
      locale: stringSchema,
    },
  },
  response: {
    200: successEnvelope(metadataSearchResponseSchema),
  },
});

export const searchSuggestionItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Id', 'Type', 'Name', 'ProductionYear', 'ImageTags', 'ProviderIds'],
  properties: {
    Id: stringSchema,
    Type: { type: 'string', enum: ['Movie', 'Series'] },
    Name: stringSchema,
    ProductionYear: nullableIntegerSchema,
    ImageTags: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['Primary'],
          properties: {
            Primary: {
              anyOf: [responsiveImageSetSchema, { type: 'null' }],
            },
          },
        },
        { type: 'null' },
      ],
    },
    ProviderIds: {
      type: 'object',
      additionalProperties: false,
      required: ['Tmdb'],
      properties: { Tmdb: nullableStringSchema },
    },
  },
} as const;

const searchSuggestionsResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: searchSuggestionItemSchema,
    },
  },
} as const;

export const searchSuggestionsRouteSchema = withDefaultErrorResponses({
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: stringSchema,
      filter: stringSchema,
      limit: positiveIntegerLikeSchema,
      locale: stringSchema,
    },
  },
  response: {
    200: successEnvelope(searchSuggestionsResponseSchema),
  },
});

const metadataTitleExtrasResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['Seasons', 'Episodes', 'Reviews', 'Similar', 'Collection'],
  properties: {
    Seasons: { type: 'array', items: baseItemDtoSchema },
    Episodes: { type: 'array', items: baseItemDtoSchema },
    Reviews: { type: 'array', items: metadataReviewViewSchema },
    Similar: { type: 'array', items: baseItemDtoSchema },
    Collection: {
      anyOf: [
        baseItemDtoQueryResultSchema,
        { type: 'null' },
      ],
    },
  },
} as const;

export const metadataItemExtrasRouteSchema = withDefaultErrorResponses({
  params: metadataItemParamsSchema,
  querystring: metadataLanguageQuerystringSchema,
  response: {
    200: successEnvelope(metadataTitleExtrasResponseSchema),
  },
});

export const metadataCardsBatchRouteSchema = withDefaultErrorResponses({
  body: metadataCardsBatchBodySchema,
  response: {
    200: successEnvelope(metadataCardsBatchResponseSchema),
  },
});
