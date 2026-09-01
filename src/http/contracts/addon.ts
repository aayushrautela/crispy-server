import {
  nonEmptyStringSchema,
  withDefaultErrorResponses,
} from './shared.js';

export const addonItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'manifestUrl', 'createdAt'],
  properties: {
    id: nonEmptyStringSchema,
    manifestUrl: nonEmptyStringSchema,
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
    201: {
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
