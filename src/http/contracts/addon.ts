import {
  nonEmptyStringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export const addonPayloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['providerId'],
  properties: {
    providerId: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
  },
} as const;

// Response payload: stremio rows carry an empty payload, jsplugin rows carry
// providerId (+optional name/version), so no field is required here.
export const addonResponsePayloadSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    providerId: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema,
  },
} as const;

export const addonItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'manifestUrl', 'createdAt'],
  properties: {
    id: nonEmptyStringSchema,
    type: { type: 'string', enum: ['stremio', 'jsplugin'] },
    manifestUrl: nonEmptyStringSchema,
    payload: addonResponsePayloadSchema,
    createdAt: nonEmptyStringSchema,
  },
} as const;

const addonListEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['addons'],
  properties: {
    addons: {
      type: 'array',
      items: addonItemSchema,
    },
  },
} as const;

const addonEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['addon'],
  properties: {
    addon: addonItemSchema,
  },
} as const;

const deleteResultEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['deleted'],
  properties: {
    deleted: { type: 'boolean' },
  },
} as const;

const addonCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['manifestUrl'],
  properties: {
    manifestUrl: nonEmptyStringSchema,
    type: { type: 'string', enum: ['stremio', 'jsplugin'] },
    payload: addonPayloadSchema,
  },
} as const;

export const addonListRouteSchema = withDefaultErrorResponses({
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'meta'],
      properties: {
        data: addonListEnvelopeSchema,
        meta: { type: 'object' },
      },
    },
  },
});

export const addonCreateRouteSchema = withDefaultErrorResponses({
  body: addonCreateBodySchema,
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'meta'],
      properties: {
        data: addonEnvelopeSchema,
        meta: { type: 'object' },
      },
    },
  },
});

export const addonDeleteRouteSchema = withDefaultErrorResponses({
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data', 'meta'],
      properties: {
        data: deleteResultEnvelopeSchema,
        meta: { type: 'object' },
      },
    },
  },
});
