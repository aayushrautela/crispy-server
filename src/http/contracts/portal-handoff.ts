import { nonEmptyStringSchema, nullableStringSchema, successEnvelope, withDefaultErrorResponses } from './shared.js';

export const createPortalHandoffRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['redirectPath'],
    properties: {
      redirectPath: nonEmptyStringSchema,
    },
  },
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['portalUrl'],
      properties: {
        portalUrl: nonEmptyStringSchema,
      },
    }),
  },
});

export const exchangePortalHandoffRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['code'],
    properties: {
      code: nonEmptyStringSchema,
    },
  },
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['csrfToken', 'expiresAt', 'user'],
      properties: {
        csrfToken: nonEmptyStringSchema,
        expiresAt: { type: 'number' },
        user: {
          type: 'object',
          required: ['id', 'email'],
          properties: {
            id: nonEmptyStringSchema,
            email: nullableStringSchema,
          },
        },
      },
    }),
  },
});

export const portalSessionRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['user'],
      properties: {
        user: {
          anyOf: [
            {
              type: 'object',
              required: ['id', 'email'],
              properties: {
                id: nonEmptyStringSchema,
                email: nullableStringSchema,
              },
            },
            { type: 'null' },
          ],
        },
        csrfToken: { type: 'string' },
        expiresAt: { type: 'number' },
      },
    }),
  },
});

export const portalSignOutRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['signedOut'],
      properties: {
        signedOut: { type: 'boolean' },
      },
    }),
  },
});
