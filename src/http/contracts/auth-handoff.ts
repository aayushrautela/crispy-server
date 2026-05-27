import { nonEmptyStringSchema, nullableStringSchema, successEnvelope, withDefaultErrorResponses } from './shared.js';

const handoffCodeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'codePreview', 'returnUri', 'expiresAt', 'consumedAt', 'createdAt'],
  properties: {
    id: nonEmptyStringSchema,
    codePreview: nonEmptyStringSchema,
    returnUri: nullableStringSchema,
    expiresAt: nonEmptyStringSchema,
    consumedAt: nullableStringSchema,
    createdAt: nonEmptyStringSchema,
  },
} as const;

const tokenSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'tokenPreview', 'scopes', 'expiresAt', 'lastUsedAt', 'revokedAt', 'createdAt'],
  properties: {
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    tokenPreview: nonEmptyStringSchema,
    scopes: { type: 'array', items: nonEmptyStringSchema },
    expiresAt: nullableStringSchema,
    lastUsedAt: nullableStringSchema,
    revokedAt: nullableStringSchema,
    createdAt: nonEmptyStringSchema,
  },
} as const;

const userSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email'],
  properties: {
    id: nonEmptyStringSchema,
    email: nullableStringSchema,
  },
} as const;

export const createAppLoginHandoffRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      returnUri: nullableStringSchema,
    },
  },
  response: {
    201: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['code', 'plaintextCode', 'redirectUri'],
      properties: {
        code: handoffCodeSchema,
        plaintextCode: nonEmptyStringSchema,
        redirectUri: nullableStringSchema,
      },
    }),
  },
});

export const exchangeAppLoginHandoffRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['code'],
    properties: {
      code: nonEmptyStringSchema,
      deviceName: nullableStringSchema,
    },
  },
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['token', 'plaintextToken', 'user'],
      properties: {
        token: tokenSchema,
        plaintextToken: nonEmptyStringSchema,
        user: userSchema,
      },
    }),
  },
});
