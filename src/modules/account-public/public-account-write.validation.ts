import { createHash } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';
import {
  PUBLIC_RECOMMENDATION_MAX_ITEMS,
  PUBLIC_TASTE_MAX_SIGNALS,
  PUBLIC_TASTE_MAX_SIGNAL_KEY_LENGTH,
  PUBLIC_TASTE_MAX_SIGNAL_LABEL_LENGTH,
  PUBLIC_TASTE_MAX_SUMMARY_LENGTH,
  PUBLIC_WRITE_IDEMPOTENCY_KEY_MAX_LENGTH,
  type PublicRecommendationItemInput,
  type PublicTasteSignalKind,
} from './public-account-write.contracts.js';
import {
  PUBLIC_RECOMMENDATION_LIST_KEY_PATTERN,
  PUBLIC_RECOMMENDATION_PROTECTED_LIST_KEY_PREFIXES,
} from './public-account-write.constants.js';

const RECOMMENDATION_ITEM_TYPES = new Set(['movie', 'tv']);
const TASTE_SIGNAL_KINDS = new Set(['genre', 'artist', 'track', 'album', 'playlist', 'mood', 'activity', 'language', 'era', 'tag']);
const REMOVED_RECOMMENDATION_TOP_LEVEL_FIELDS = ['schemaVersion', 'mediaType', 'locale', 'summary', 'clientContext', 'source', 'purpose', 'writeMode', 'input', 'eligibilityVersion', 'signalsVersion', 'modelVersion', 'algorithm'];
const REMOVED_RECOMMENDATION_ITEM_FIELDS = ['rank', 'score', 'provider', 'providerItemId', 'mediaType', 'title', 'artists', 'album', 'imageUrl', 'reason', 'durationMs', 'releaseDate', 'explicit', 'contentId', 'mediaKey', 'reasonCodes', 'metadata', 'media', 'payload'];

export interface NormalizedPublicRecommendationItem extends PublicRecommendationItemInput {}

export interface NormalizedPublicRecommendationListInput {
  items: NormalizedPublicRecommendationItem[];
  requestHash: string;
}

export interface NormalizedPublicTasteSignal {
  kind: PublicTasteSignalKind;
  key?: string;
  provider?: string;
  providerItemId?: string;
  label?: string;
  weight: number;
  confidence?: number;
}

export interface NormalizedPublicTasteProfileInput {
  summary?: string;
  locale?: string;
  signals: NormalizedPublicTasteSignal[];
  clientContext?: Record<string, unknown>;
  requestHash: string;
}

export function validatePublicListKeyForWrite(listKey: string): string {
  const normalized = listKey.trim().toLowerCase();
  if (PUBLIC_RECOMMENDATION_PROTECTED_LIST_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new HttpError(400, 'Protected recommendation list key.', undefined, 'PROTECTED_RECOMMENDATION_LIST');
  }
  if (!PUBLIC_RECOMMENDATION_LIST_KEY_PATTERN.test(normalized)) {
    throw new HttpError(400, 'Invalid recommendation list key.', undefined, 'INVALID_LIST_KEY');
  }
  return normalized;
}

export function normalizePublicRecommendationListInput(input: unknown): NormalizedPublicRecommendationListInput {
  assertRecord(input, 'request body');
  rejectRemovedFields(input, REMOVED_RECOMMENDATION_TOP_LEVEL_FIELDS, '');
  assertExactKeys(input, ['items']);
  if (!Array.isArray(input.items) || input.items.length > PUBLIC_RECOMMENDATION_MAX_ITEMS) throw new HttpError(400, 'items must be an array.', { field: 'items' }, 'INVALID_RECOMMENDATION_ITEMS');
  const seen = new Set<string>();
  const items = input.items.map((raw, index) => {
    const path = `items[${index}]`;
    assertRecord(raw, path);
    rejectRemovedFields(raw, REMOVED_RECOMMENDATION_ITEM_FIELDS, path);
    assertExactKeys(raw, ['type', 'tmdbId'], path);
    if (!RECOMMENDATION_ITEM_TYPES.has(String(raw.type))) throw new HttpError(400, `${path}.type must be movie or tv.`, { field: `${path}.type` }, 'INVALID_RECOMMENDATION_ITEM_TYPE');
    if (typeof raw.tmdbId !== 'number' || !Number.isSafeInteger(raw.tmdbId) || raw.tmdbId < 1) throw new HttpError(400, `${path}.tmdbId must be a positive integer.`, { field: `${path}.tmdbId` }, 'INVALID_RECOMMENDATION_TMDB_ID');
    const type = raw.type as PublicRecommendationItemInput['type'];
    const tmdbId = raw.tmdbId;
    const mediaKey = `${type}:tmdb:${tmdbId}`;
    if (seen.has(mediaKey)) throw new HttpError(400, `Duplicate recommendation item at ${path}.`, { field: path, mediaKey }, 'DUPLICATE_RECOMMENDATION_ITEM');
    seen.add(mediaKey);
    return { type, tmdbId };
  });
  const normalized = { items };
  return { ...normalized, requestHash: hashPublicWriteRequest(normalized) };
}

export function normalizePublicTasteProfileInput(input: unknown): NormalizedPublicTasteProfileInput {
  assertRecord(input, 'request body');
  assertExactKeys(input, ['summary', 'locale', 'signals', 'clientContext']);
  if (!Array.isArray(input.signals) || input.signals.length < 1 || input.signals.length > PUBLIC_TASTE_MAX_SIGNALS) throw new HttpError(400, 'Invalid taste signals.');
  const seen = new Set<string>();
  const signals = input.signals.map((raw) => {
    assertRecord(raw, 'taste signal');
    assertExactKeys(raw, ['kind', 'key', 'provider', 'providerItemId', 'label', 'weight', 'confidence']);
    if (!TASTE_SIGNAL_KINDS.has(String(raw.kind))) throw new HttpError(400, 'Invalid taste signal kind.');
    const kind = raw.kind as PublicTasteSignalKind;
    const key = raw.key === undefined ? undefined : normalizeOptionalString(raw.key, 'key', PUBLIC_TASTE_MAX_SIGNAL_KEY_LENGTH);
    const label = raw.label === undefined ? undefined : normalizeOptionalString(raw.label, 'label', PUBLIC_TASTE_MAX_SIGNAL_LABEL_LENGTH);
    const provider = raw.provider === undefined ? undefined : normalizeOptionalString(raw.provider, 'provider', 100);
    const providerItemId = raw.providerItemId === undefined ? undefined : normalizeRequiredString(raw.providerItemId, 'providerItemId', 300);
    if (!key && !(provider && providerItemId)) throw new HttpError(400, 'Taste signal requires key or provider identity.');
    const dedupe = key ? `${kind}:key:${key}` : `${kind}:provider:${provider}:${providerItemId}`;
    if (seen.has(dedupe)) throw new HttpError(400, 'Duplicate taste signal.');
    seen.add(dedupe);
    return {
      kind,
      key,
      provider,
      providerItemId,
      label,
      weight: requireFiniteNumber(raw.weight, 'weight', -1, 1),
      confidence: raw.confidence === undefined ? undefined : requireFiniteNumber(raw.confidence, 'confidence', 0, 1),
    };
  });
  const normalized = {
    summary: input.summary === undefined ? undefined : normalizeOptionalString(input.summary, 'summary', PUBLIC_TASTE_MAX_SUMMARY_LENGTH),
    locale: input.locale === undefined ? undefined : normalizeLocale(input.locale),
    signals,
    clientContext: input.clientContext === undefined ? undefined : normalizeClientContext(input.clientContext),
  };
  return { ...normalized, requestHash: hashPublicWriteRequest(normalized) };
}

export function parsePublicWriteIfMatchHeader(ifMatch?: string): number | undefined {
  if (!ifMatch) return undefined;
  const trimmed = ifMatch.trim();
  const match = /^"?(\d+)"?$/.exec(trimmed);
  if (!match) throw new HttpError(400, 'Invalid If-Match header.');
  return Number(match[1]);
}

export function normalizeAndValidateIdempotencyKey(key?: string): string | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > PUBLIC_WRITE_IDEMPOTENCY_KEY_MAX_LENGTH || !/^[a-zA-Z0-9._:-]+$/.test(trimmed)) {
    throw new HttpError(400, 'Invalid Idempotency-Key header.');
  }
  return trimmed;
}

export function hashPublicWriteRequest(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function assertRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, `Invalid ${name}.`, { field: name }, 'INVALID_REQUEST_BODY');
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], path = ''): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      const field = path ? `${path}.${key}` : key;
      throw new HttpError(400, `Unknown field: ${field}`, { field }, 'UNSUPPORTED_RECOMMENDATION_WRITE_FIELD');
    }
  }
}

function rejectRemovedFields(value: Record<string, unknown>, fields: string[], path: string): void {
  for (const field of fields) {
    if (field in value) {
      const qualifiedField = path ? `${path}.${field}` : field;
      throw new HttpError(400, `${qualifiedField} is server-derived and must not be supplied.`, { field: qualifiedField }, 'UNSUPPORTED_RECOMMENDATION_WRITE_FIELD');
    }
  }
}

function normalizeRequiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `Invalid ${field}.`);
  const normalized = normalizePublicWriteString(value);
  if (!normalized || normalized.length > max) throw new HttpError(400, `Invalid ${field}.`);
  return normalized;
}

function normalizeOptionalString(value: unknown, field: string, max: number): string | undefined {
  if (typeof value !== 'string') throw new HttpError(400, `Invalid ${field}.`);
  const normalized = normalizePublicWriteString(value);
  if (!normalized) return undefined;
  if (normalized.length > max) throw new HttpError(400, `Invalid ${field}.`);
  return normalized;
}

export function normalizePublicWriteString(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (/\p{C}/u.test(normalized) || /<[^>]+>/.test(normalized)) throw new HttpError(400, 'Invalid text field.');
  return normalized;
}

function requireFiniteNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `Invalid ${field}.`);
  return value;
}

function normalizeLocale(value: unknown): string {
  const locale = normalizeRequiredString(value, 'locale', 35);
  if (!/^[a-zA-Z]{2,3}([_-][a-zA-Z0-9]{2,8})*$/.test(locale)) throw new HttpError(400, 'Invalid locale.');
  return locale;
}

function normalizeClientContext(value: unknown): Record<string, unknown> {
  assertRecord(value, 'clientContext');
  const serialized = JSON.stringify(value);
  if (serialized.length > 5000) throw new HttpError(400, 'clientContext too large.');
  return value;
}
