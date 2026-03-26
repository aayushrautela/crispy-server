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

export function withDefaultErrorResponses<T extends RouteSchema>(schema: T): T & { response: Record<number, unknown> } {
  return {
    ...schema,
    response: {
      ...defaultErrorResponseSchemas,
      ...(schema.response ?? {}),
    },
  };
}
