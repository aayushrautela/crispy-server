import {
  booleanSchema,
  clientMediaCardSchema,
  integerLikeSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';

export type BrowseTitlesQuery = {
  type?: string;
  genre?: string;
  sort?: string;
  page?: number | string;
  locale?: string;
};

const browseTitlesResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'total', 'hasMore'],
  properties: {
    items: { type: 'array', items: clientMediaCardSchema },
    total: { type: 'integer', minimum: 0 },
    hasMore: booleanSchema,
  },
} as const;

export const browseTitlesRouteSchema = withDefaultErrorResponses({
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: stringSchema,
      genre: stringSchema,
      sort: stringSchema,
      page: integerLikeSchema,
      locale: stringSchema,
    },
  },
  response: {
    200: successEnvelope(browseTitlesResponseSchema),
  },
});