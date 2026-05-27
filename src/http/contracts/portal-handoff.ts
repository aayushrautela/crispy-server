import { nonEmptyStringSchema, successEnvelope, withDefaultErrorResponses } from './shared.js';

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
      required: ['accessToken', 'refreshToken'],
      properties: {
        accessToken: nonEmptyStringSchema,
        refreshToken: nonEmptyStringSchema,
      },
    }),
  },
});
