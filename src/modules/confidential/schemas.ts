import { HttpError } from '../../lib/errors.js';
import type { ConfidentialBundleRequest, ConfidentialResourceSelector } from './types.js';

export function parseConfidentialBundleRequest(body: unknown): ConfidentialBundleRequest {
  const value = asRecord(body);
  if (!Array.isArray(value.resources)) {
    throw new HttpError(400, 'resources must be an array.');
  }

  const resources = value.resources.map((resource, index): ConfidentialResourceSelector => {
    const entry = asRecord(resource);
    const kind = typeof entry.kind === 'string' ? entry.kind.trim() : '';
    const purpose = typeof entry.purpose === 'string' ? entry.purpose.trim() : '';
    const version = entry.version;

    if (kind !== 'aiConfig') {
      throw new HttpError(404, `Confidential resource at resources[${index}] was not found.`);
    }
    if (version !== 1) {
      throw new HttpError(404, `Confidential resource version at resources[${index}] was not found.`);
    }
    if (purpose !== 'recommendation-generation') {
      throw new HttpError(404, `Confidential resource purpose at resources[${index}] was not found.`);
    }

    return { kind, version, purpose };
  });

  return { resources };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) 
    ? value as Record<string, unknown> 
    : {};
}
