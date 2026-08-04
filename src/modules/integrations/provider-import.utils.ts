import { HttpError } from '../../lib/errors.js';
import { normalizeIsoString } from '../../lib/time.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function asIsoString(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  return normalizeIsoString(text);
}

export function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

export function normalizeProviderId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function firstIsoString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asIsoString(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function parseProviderJson(rawBody: string): Record<string, unknown> | null {
  if (!rawBody.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseProviderPayload(rawBody: string): unknown {
  if (!rawBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

export function extractProviderArray(payload: unknown, collectionKey?: string): Array<Record<string, unknown>> | null {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (isRecord(payload) && collectionKey) {
    const value = payload[collectionKey];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return null;
}

export function resolveProviderError(payload: Record<string, unknown> | null, fallback: string): string {
  if (typeof payload?.error_description === 'string' && payload.error_description.trim()) {
    return payload.error_description;
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

export function expiresAtIsoFromNow(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(Date.now() + value * 1000).toISOString();
}

export function clampProgressBps(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(10000, Math.round(value)));
}

export function positiveIntegerOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

export function nonNegativeIntegerOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

export function durationSecondsFromRuntime(value: unknown): number | null {
  const runtimeMinutes = asFiniteNumber(value);
  if (runtimeMinutes === null || runtimeMinutes <= 0) {
    return null;
  }
  return Math.round(runtimeMinutes * 60);
}

export function progressBpsFromPosition(positionSeconds: number | null, durationSeconds: number | null): number | null {
  if (positionSeconds === null || durationSeconds === null || durationSeconds <= 0) {
    return null;
  }
  return Math.round((positionSeconds / durationSeconds) * 10000);
}

export function requireConnectedAccessToken(credentialsJson: Record<string, unknown>): string {
  const accessToken = asString(credentialsJson.accessToken);
  if (!accessToken) {
    throw new HttpError(400, 'Provider connection is missing an access token.');
  }
  return accessToken;
}

export function buildConnectedSessionCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
  return {
    accessToken: asString(credentials.accessToken),
    refreshToken: asString(credentials.refreshToken),
    accessTokenExpiresAt: asIsoString(credentials.accessTokenExpiresAt),
    connectedAt: asIsoString(credentials.connectedAt),
    lastRefreshAt: asIsoString(credentials.lastRefreshAt),
    lastImportJobId: asString(credentials.lastImportJobId),
    lastImportCompletedAt: asIsoString(credentials.lastImportCompletedAt),
  };
}

export function sanitizeReauthSessionCredentials(
  credentials: Record<string, unknown>,
  refreshError: string | null,
): Record<string, unknown> {
  return {
    connectedAt: asIsoString(credentials.connectedAt),
    lastRefreshAt: asIsoString(credentials.lastRefreshAt),
    lastRefreshError: refreshError,
    lastImportJobId: asString(credentials.lastImportJobId),
    lastImportCompletedAt: asIsoString(credentials.lastImportCompletedAt),
  };
}

export function sanitizeDisconnectedCredentials(
  credentials: unknown,
  disconnectedAt: string,
  disconnectedByUserId: string,
): Record<string, unknown> {
  const safeCredentials = isRecord(credentials) ? credentials : {};
  return {
    lastImportJobId: asString(safeCredentials.lastImportJobId),
    lastImportCompletedAt: asIsoString(safeCredentials.lastImportCompletedAt),
    lastRefreshAt: asIsoString(safeCredentials.lastRefreshAt),
    lastRefreshError: null,
    disconnectedAt,
    disconnectedByUserId,
  };
}
