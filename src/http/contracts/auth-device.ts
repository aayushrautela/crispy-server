import { nonEmptyStringSchema, nullableStringSchema, successEnvelope, withDefaultErrorResponses } from './shared.js';

const deviceAuthorizationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['deviceCode', 'userCode', 'verificationUri', 'verificationUriComplete', 'expiresIn', 'interval'],
  properties: {
    deviceCode: nonEmptyStringSchema,
    userCode: nonEmptyStringSchema,
    verificationUri: nonEmptyStringSchema,
    verificationUriComplete: nonEmptyStringSchema,
    expiresIn: { type: 'integer' },
    interval: { type: 'integer' },
  },
} as const;

const deviceApprovalViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clientId', 'deviceName', 'expiresAt', 'deviceId'],
  properties: {
    clientId: nonEmptyStringSchema,
    deviceName: nullableStringSchema,
    expiresAt: nonEmptyStringSchema,
    deviceId: nullableStringSchema,
  },
} as const;

const deviceRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'clientId', 'deviceName', 'deviceType', 'lastSeenAt', 'revokedAt', 'createdAt', 'activeTokenPreview'],
  properties: {
    id: nonEmptyStringSchema,
    clientId: nonEmptyStringSchema,
    deviceName: nullableStringSchema,
    deviceType: { type: 'string', enum: ['tv', 'mobile', 'web', 'desktop'] },
    lastSeenAt: nullableStringSchema,
    revokedAt: nullableStringSchema,
    createdAt: nonEmptyStringSchema,
    activeTokenPreview: nullableStringSchema,
  },
} as const;

const deviceTokenSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'tokenPreview', 'scopes', 'expiresAt', 'createdAt'],
  properties: {
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    tokenPreview: nonEmptyStringSchema,
    scopes: { type: 'array', items: nonEmptyStringSchema },
    expiresAt: nullableStringSchema,
    createdAt: nonEmptyStringSchema,
  },
} as const;

const deviceUserSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email'],
  properties: {
    id: nonEmptyStringSchema,
    email: nullableStringSchema,
  },
} as const;

const deviceTokenApprovedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'plaintextToken', 'deviceId', 'token', 'user'],
  properties: {
    status: { type: 'string', enum: ['approved'] },
    plaintextToken: nonEmptyStringSchema,
    deviceId: nonEmptyStringSchema,
    token: deviceTokenSchema,
    user: deviceUserSchema,
  },
} as const;

const deviceTokenOutcomeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['authorization_pending', 'slow_down', 'access_denied', 'expired_token'] },
    interval: { type: 'integer' },
  },
} as const;

export const createDeviceAuthorizationRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['clientId'],
    properties: {
      clientId: nonEmptyStringSchema,
      deviceName: nullableStringSchema,
      deviceId: nullableStringSchema,
    },
  },
  response: {
    201: successEnvelope(deviceAuthorizationResponseSchema),
  },
});

export const pollDeviceTokenRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['deviceCode'],
    properties: {
      deviceCode: nonEmptyStringSchema,
    },
  },
  response: {
    200: {
      anyOf: [
        successEnvelope(deviceTokenApprovedSchema),
        successEnvelope(deviceTokenOutcomeSchema),
      ],
    },
  },
});

export const lookupDeviceUserCodeRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['userCode'],
    properties: {
      userCode: nonEmptyStringSchema,
    },
  },
  response: {
    200: successEnvelope(deviceApprovalViewSchema),
  },
});

export const approveDeviceUserCodeRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['userCode'],
    properties: {
      userCode: nonEmptyStringSchema,
    },
  },
  response: {
    200: successEnvelope(deviceApprovalViewSchema),
  },
});

export const denyDeviceUserCodeRouteSchema = withDefaultErrorResponses({
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['userCode'],
    properties: {
      userCode: nonEmptyStringSchema,
    },
  },
  response: {
    200: successEnvelope(deviceApprovalViewSchema),
  },
});

export const listDevicesRouteSchema = withDefaultErrorResponses({
  response: {
    200: successEnvelope({
      type: 'object',
      additionalProperties: false,
      required: ['devices'],
      properties: {
        devices: { type: 'array', items: deviceRecordSchema },
      },
    }),
  },
});

export const revokeDeviceRouteSchema = withDefaultErrorResponses({
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['deviceId'],
    properties: {
      deviceId: nonEmptyStringSchema,
    },
  },
  response: {
    204: { type: 'null' },
  },
});
