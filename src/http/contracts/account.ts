import {
  booleanSchema,
  nonEmptyStringSchema,
  recordSchema,
  stringSchema,
  successEnvelope,
  withDefaultErrorResponses,
} from './shared.js';

export const metadataClientSettingsSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    hasMdbListAccess: booleanSchema,
  },
} as const;

export const accountScopedSettingsSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    pricingTier: {
      type: 'string',
      enum: ['free', 'lite', 'pro', 'ultra'],
    },
    metadata: metadataClientSettingsSchema,
  },
} as const;

const accountSettingsEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['settings'],
  properties: {
    settings: accountScopedSettingsSchema,
  },
} as const;

const accountSecretValueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['appUserId', 'key', 'present', 'fingerprint'],
  properties: {
    appUserId: nonEmptyStringSchema,
    key: nonEmptyStringSchema,
    present: booleanSchema,
    fingerprint: nonEmptyStringSchema,
  },
} as const;

const secretEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['secret'],
  properties: {
    secret: accountSecretValueSchema,
  },
} as const;

const deleteEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['deleted'],
  properties: {
    deleted: booleanSchema,
  },
} as const;

const secretValueBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: stringSchema,
  },
} as const;

export const accountSettingsRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope(accountSettingsEnvelopeSchema),
  },
});

export const accountSettingsPatchRouteSchema = withDefaultErrorResponses({
  body: recordSchema,
  response: {
    200: successEnvelope(accountSettingsEnvelopeSchema),
  },
});

export const mdblistAccountSecretGetRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope(secretEnvelopeSchema),
  },
});

export const mdblistAccountSecretPutRouteSchema = withDefaultErrorResponses({
  body: secretValueBodySchema,
  response: {
    200: successEnvelope(secretEnvelopeSchema),
  },
});

export const deleteResultRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope(deleteEnvelopeSchema),
  },
});

export const meRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['user', 'accountSettings', 'profiles'],
      properties: {
        user: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'email'],
          properties: {
            id: nonEmptyStringSchema,
            email: nonEmptyStringSchema,
          },
        },
        accountSettings: accountScopedSettingsSchema,
        profiles: {
          type: 'array',
          items: recordSchema,
        },
      },
    }),
  },
});
