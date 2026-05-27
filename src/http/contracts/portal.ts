import { nonEmptyStringSchema, nullableStringSchema, recordSchema, stringSchema, successEnvelope, withDefaultErrorResponses } from './shared.js';

const portalUserSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email'],
  properties: {
    id: nonEmptyStringSchema,
    email: nullableStringSchema,
  },
} as const;

const portalProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'interfaceLanguage', 'region', 'isKids', 'sortOrder', 'avatarKey'],
  properties: {
    id: nonEmptyStringSchema,
    name: stringSchema,
    interfaceLanguage: stringSchema,
    region: nullableStringSchema,
    isKids: { type: 'boolean' },
    sortOrder: { type: 'number' },
    avatarKey: nullableStringSchema,
  },
} as const;

export const portalMeRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['user', 'accountSettings', 'profiles'],
      properties: {
        user: portalUserSchema,
        accountSettings: recordSchema,
        profiles: {
          type: 'array',
          items: portalProfileSchema,
        },
      },
    }),
  },
});

export const portalProfilesListRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['profiles'],
      properties: {
        profiles: {
          type: 'array',
          items: portalProfileSchema,
        },
      },
    }),
  },
});

export const portalProfileCreateRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: nonEmptyStringSchema,
      interfaceLanguage: { type: 'string' },
      region: nullableStringSchema,
      isKids: { type: 'boolean' },
      avatarKey: nullableStringSchema,
      sortOrder: { type: 'number' },
    },
  },
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['profile'],
      properties: {
        profile: portalProfileSchema,
      },
    }),
  },
});

const profileIdParams = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId'],
  properties: {
    profileId: nonEmptyStringSchema,
  },
} as const;

export const portalProfileUpdateRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: stringSchema,
      interfaceLanguage: { type: 'string' },
      region: nullableStringSchema,
      isKids: { type: 'boolean' },
      avatarKey: nullableStringSchema,
      sortOrder: { type: 'number' },
    },
  },
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['profile'],
      properties: {
        profile: portalProfileSchema,
      },
    }),
  },
});

const portalPatSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'createdAt', 'lastUsedAt'],
  properties: {
    id: nonEmptyStringSchema,
    name: stringSchema,
    scopes: { type: 'array', items: stringSchema },
    expiresAt: nullableStringSchema,
    lastUsedAt: nullableStringSchema,
    createdAt: stringSchema,
  },
} as const;

export const portalApiKeysListRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: { type: 'array', items: portalPatSchema },
      },
    }),
  },
});

export const portalApiKeyCreateRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: nonEmptyStringSchema,
      scopes: { type: 'array', items: stringSchema },
      expiresAt: nullableStringSchema,
    },
  },
  response: {
    201: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['token'],
      properties: {
        token: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name'],
          properties: {
            id: nonEmptyStringSchema,
            name: stringSchema,
            plaintext: { type: 'string' },
          },
        },
      },
    }),
  },
});

export const portalApiKeyRevokeRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['tokenId'],
    properties: {
      tokenId: nonEmptyStringSchema,
    },
  },
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['token'],
      properties: {
        token: portalPatSchema,
      },
    }),
  },
});

const providerStateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'provider',
    'connectionState',
    'accountStatus',
    'primaryAction',
    'canImport',
    'canReconnect',
    'canDisconnect',
    'externalUsername',
    'statusLabel',
    'statusMessage',
    'lastImportCompletedAt',
  ],
  properties: {
    provider: { type: 'string', enum: ['trakt', 'simkl'] },
    connectionState: { type: 'string', enum: ['not_connected', 'pending_authorization', 'connected', 'reauthorization_required'] },
    accountStatus: { anyOf: [{ type: 'string', enum: ['pending', 'connected', 'expired', 'revoked'] }, { type: 'null' }] },
    primaryAction: { type: 'string', enum: ['connect', 'import', 'reconnect'] },
    canImport: { type: 'boolean' },
    canReconnect: { type: 'boolean' },
    canDisconnect: { type: 'boolean' },
    externalUsername: nullableStringSchema,
    statusLabel: stringSchema,
    statusMessage: nullableStringSchema,
    lastImportCompletedAt: nullableStringSchema,
  },
} as const;

const watchDataStateSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['profileId', 'watchDataUpdatedAt', 'watchDataOrigin', 'lastImportCompletedAt'],
      properties: {
        profileId: stringSchema,
        watchDataUpdatedAt: stringSchema,
        watchDataOrigin: { type: 'string', enum: ['native', 'provider_import'] },
        lastImportCompletedAt: nullableStringSchema,
      },
    },
    { type: 'null' },
  ],
} as const;

export const portalProviderConnectionsRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['providerStates', 'watchDataState'],
      properties: {
        providerStates: { type: 'array', items: providerStateSchema },
        watchDataState: watchDataStateSchema,
      },
    }),
  },
});

export const portalProviderConnectionsDeleteRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['profileId', 'provider'],
    properties: {
      profileId: nonEmptyStringSchema,
      provider: nonEmptyStringSchema,
    },
  },
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['providerState'],
      properties: {
        providerState: providerStateSchema,
      },
    }),
  },
});

export const portalImportStartRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['provider', 'action'],
    properties: {
      provider: { type: 'string', enum: ['trakt', 'simkl'] },
      action: { type: 'string', enum: ['connect', 'reconnect', 'import'] },
    },
  },
  response: {
    201: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['job', 'providerState', 'watchDataState', 'authUrl', 'nextAction'],
      properties: {
        job: { anyOf: [{ type: 'object' }, { type: 'null' }] },
        providerState: providerStateSchema,
        watchDataState: watchDataStateSchema,
        authUrl: nullableStringSchema,
        nextAction: { type: 'string', enum: ['authorize_provider', 'queued'] },
      },
    }),
    202: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['job', 'providerState', 'watchDataState', 'authUrl', 'nextAction'],
      properties: {
        job: { anyOf: [{ type: 'object' }, { type: 'null' }] },
        providerState: providerStateSchema,
        watchDataState: watchDataStateSchema,
        authUrl: nullableStringSchema,
        nextAction: { type: 'string', enum: ['authorize_provider', 'queued'] },
      },
    }),
  },
});

export const portalImportsListRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['jobs'],
      properties: {
        jobs: { type: 'array', items: { type: 'object' } },
      },
    }),
  },
});

const profileIdAndJobIdParams = {
  type: 'object',
  additionalProperties: false,
  required: ['profileId', 'jobId'],
  properties: {
    profileId: nonEmptyStringSchema,
    jobId: nonEmptyStringSchema,
  },
} as const;

export const portalImportJobGetRouteSchema = withDefaultErrorResponses({
  params: profileIdAndJobIdParams,
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['job'],
      properties: {
        job: { type: 'object' },
      },
    }),
  },
});

export const portalProfileSettingsGetRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['settings'],
      properties: {
        settings: recordSchema,
      },
    }),
  },
});

export const portalProfileSettingsPatchRouteSchema = withDefaultErrorResponses({
  params: profileIdParams,
  body: recordSchema,
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['settings'],
      properties: {
        settings: recordSchema,
      },
    }),
  },
});
