import { HttpError } from './errors.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function normalizeIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeOptionalIsoString(value: Date | string | null | undefined, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' && !value.trim()) {
    return null;
  }

  return requireNormalizedIsoString(value, fieldName);
}

export function requireNormalizedIsoString(value: Date | string | null | undefined, fieldName: string): string {
  const normalized = normalizeIsoString(value);
  if (normalized !== null) {
    return normalized;
  }

  throw new HttpError(
    400,
    `Invalid ${fieldName} timestamp.`,
    { field: fieldName, value },
    'invalid_timestamp',
  );
}
