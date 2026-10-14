const urlStringSchema = {
  type: 'string',
  maxLength: 8192,
} as const;

const originStringSchema = {
  type: 'string',
  maxLength: 2048,
} as const;

const forwardableHeadersSchema = {
  type: 'object',
  additionalProperties: {
    type: 'string',
  },
} as const;

const resolveUrlBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: urlStringSchema,
    headers: forwardableHeadersSchema,
    origin: originStringSchema,
  },
} as const;

const resolveUrlQuerySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    url: urlStringSchema,
    headers: { type: 'string' },
    origin: originStringSchema,
  },
} as const;

export const resolveUrlRouteSchema = {
  body: resolveUrlBodySchema,
  querystring: resolveUrlQuerySchema,
};

export const resolveUrlQueryRouteSchema = {
  querystring: resolveUrlQuerySchema,
};
