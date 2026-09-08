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
  required: ['clientId', 'deviceName', 'expiresAt'],
  properties: {
    clientId: nonEmptyStringSchema,
    deviceName: nullableStringSchema,
    expiresAt: nonEmptyStringSchema,
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
  required: ['status', 'plaintextToken', 'token', 'user'],
  properties: {
    status: { type: 'string', enum: ['approved'] },
    plaintextToken: nonEmptyStringSchema,
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
