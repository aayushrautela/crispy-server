import { HttpError } from './errors.js';

type TimestampLike = Date | string;
type NullableTimestampLike = TimestampLike | null | undefined;

function parseTimestamp(value: TimestampLike): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isBlankString(value: NullableTimestampLike): value is string {
  return typeof value === 'string' && !value.trim();
}

function invalidDbTimestampError(fieldName: string, value: NullableTimestampLike): Error {
  return new Error(`Invalid DB timestamp for ${fieldName}.`, { cause: value });
}

function missingDbTimestampError(fieldName: string): Error {
  return new Error(`Missing DB timestamp for ${fieldName}.`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIsoString(value: TimestampLike): string {
  return requireParsedTimestamp(value).toISOString();
}

export function normalizeIsoString(value: NullableTimestampLike): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return parseTimestamp(value)?.toISOString() ?? null;
}

export function normalizeOptionalIsoString(value: NullableTimestampLike, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (isBlankString(value)) {
    return null;
  }

  return requireNormalizedIsoString(value, fieldName);
}

export function requireNormalizedIsoString(value: NullableTimestampLike, fieldName: string): string {
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

export function toDbIsoString(value: NullableTimestampLike, fieldName: string): string | null {
  if (value === null || value === undefined || isBlankString(value)) {
    return null;
  }

  const normalized = normalizeIsoString(value);
  if (normalized !== null) {
    return normalized;
  }

  throw invalidDbTimestampError(fieldName, value);
}

export function requireDbIsoString(value: NullableTimestampLike, fieldName: string): string {
  const normalized = toDbIsoString(value, fieldName);
  if (normalized !== null) {
    return normalized;
  }

  throw missingDbTimestampError(fieldName);
}

function requireParsedTimestamp(value: TimestampLike): Date {
  const parsed = parseTimestamp(value);
  if (parsed !== null) {
    return parsed;
  }

  throw invalidDbTimestampError('value', value);
}
