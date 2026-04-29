import type { ConfidentialResourceDefinition, ConfidentialResourceSelector } from './types.js';

export const confidentialResourceRegistry = [
  {
    kind: 'aiConfig',
    version: 1,
    purpose: 'recommendation-generation',
    requiredScopes: ['confidential-config:ai-config:read'],
  },
] satisfies ConfidentialResourceDefinition[];

export function isConfidentialResourceSelector(value: ConfidentialResourceSelector): boolean {
  return confidentialResourceRegistry.some((entry) =>
    entry.kind === value.kind && entry.version === value.version && entry.purpose === value.purpose,
  );
}

export function getConfidentialResourceDefinition(value: ConfidentialResourceSelector): ConfidentialResourceDefinition | undefined {
  return confidentialResourceRegistry.find((entry) =>
    entry.kind === value.kind && entry.version === value.version && entry.purpose === value.purpose,
  );
}
