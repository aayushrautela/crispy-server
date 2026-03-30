import {
  booleanSchema,
  nonEmptyStringSchema,
  recordSchema,
  stringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export const aiProviderViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'endpointUrl'],
  properties: {
    id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    endpointUrl: nonEmptyStringSchema,
  },
} as const;

export const aiClientSettingsSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['providerId', 'hasAiApiKey', 'defaultProviderId', 'providers'],
  properties: {
    providerId: nonEmptyStringSchema,
    hasAiApiKey: booleanSchema,
    defaultProviderId: nonEmptyStringSchema,
    providers: {
      type: 'array',
      items: aiProviderViewSchema,
    },
  },
} as const;

export const metadataClientSettingsSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    hasOmdbApiKey: booleanSchema,
  },
} as const;

export const accountScopedSettingsSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ai: aiClientSettingsSchema,
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
  required: ['appUserId', 'key', 'value'],
  properties: {
    appUserId: nonEmptyStringSchema,
    key: nonEmptyStringSchema,
    value: nonEmptyStringSchema,
  },
} as const;

const internalAiSecretValueSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['appUserId', 'key', 'value', 'providerId'],
  properties: {
    appUserId: nonEmptyStringSchema,
    key: nonEmptyStringSchema,
    value: nonEmptyStringSchema,
    providerId: nonEmptyStringSchema,
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

const internalAiSecretEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['secret'],
  properties: {
    secret: internalAiSecretValueSchema,
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
    200: accountSettingsEnvelopeSchema,
  },
});

export const accountSettingsPatchRouteSchema = withDefaultErrorResponses({
  body: recordSchema,
  response: {
    200: accountSettingsEnvelopeSchema,
  },
});

export const aiAccountSecretGetRouteSchema = withDefaultErrorResponses({
  response: {
    200: secretEnvelopeSchema,
  },
});

export const aiAccountSecretPutRouteSchema = withDefaultErrorResponses({
  body: secretValueBodySchema,
  response: {
    200: secretEnvelopeSchema,
  },
});

export const deleteResultRouteSchema = withDefaultErrorResponses({
  response: {
    200: deleteEnvelopeSchema,
  },
});

export const meRouteSchema = withDefaultErrorResponses({
  response: {
    200: {
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
    },
  },
});

const internalAccountProfileParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'profileId'],
  properties: {
    accountId: nonEmptyStringSchema,
    profileId: nonEmptyStringSchema,
  },
} as const;

export const internalAiSecretRouteSchema = withDefaultErrorResponses({
  params: internalAccountProfileParamsSchema,
  response: {
    200: internalAiSecretEnvelopeSchema,
  },
});
