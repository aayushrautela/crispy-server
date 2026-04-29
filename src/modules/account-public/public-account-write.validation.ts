import { createHash } from 'node:crypto';
import { HttpError } from '../../lib/errors.js';
import {
  PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION,
  PUBLIC_RECOMMENDATION_MAX_ITEMS,
  PUBLIC_RECOMMENDATION_MAX_REASON_LENGTH,
  PUBLIC_RECOMMENDATION_MAX_SUMMARY_LENGTH,
  PUBLIC_RECOMMENDATION_MAX_TITLE_LENGTH,
  PUBLIC_TASTE_MAX_SIGNALS,
  PUBLIC_TASTE_MAX_SIGNAL_KEY_LENGTH,
  PUBLIC_TASTE_MAX_SIGNAL_LABEL_LENGTH,
  PUBLIC_TASTE_MAX_SUMMARY_LENGTH,
  PUBLIC_WRITE_IDEMPOTENCY_KEY_MAX_LENGTH,
  type PublicRecommendationItemInput,
  type PublicRecommendationMediaType,
  type PublicRecommendationProvider,
  type PublicRecommendationItemMediaType,
  type PublicTasteSignalKind,
  type ReplacePublicRecommendationListRequest,
  type ReplacePublicTasteProfileRequest,
} from './public-account-write.contracts.js';
import {
  PUBLIC_RECOMMENDATION_LIST_KEY_PATTERN,
  PUBLIC_RECOMMENDATION_PROTECTED_LIST_KEY_PREFIXES,
} from './public-account-write.constants.js';

const PROVIDERS = new Set(['spotify', 'apple_music', 'youtube_music', 'youtube', 'soundcloud', 'custom']);
const RECO_MEDIA_TYPES = new Set(['track', 'album', 'artist', 'playlist', 'podcast', 'episode', 'video', 'mixed']);
const ITEM_MEDIA_TYPES = new Set(['track', 'album', 'artist', 'playlist', 'podcast', 'episode', 'video']);
const TASTE_SIGNAL_KINDS = new Set(['genre', 'artist', 'track', 'album', 'playlist', 'mood', 'activity', 'language', 'era', 'tag']);

export interface NormalizedPublicRecommendationItem extends PublicRecommendationItemInput {
  rank: number;
  originalIndex: number;
}

export interface NormalizedPublicRecommendationListInput {
  schemaVersion: typeof PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION;
  mediaType: PublicRecommendationMediaType;
  locale?: string;
  summary?: string;
  items: NormalizedPublicRecommendationItem[];
  clientContext?: Record<string, unknown>;
  requestHash: string;
}

export interface NormalizedPublicTasteSignal {
  kind: PublicTasteSignalKind;
  key?: string;
  provider?: PublicRecommendationProvider;
  providerItemId?: string;
  label?: string;
  weight: number;
  confidence?: number;
}

export interface NormalizedPublicTasteProfileInput {
  schemaVersion: typeof PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION;
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
  assertExactKeys(input, ['schemaVersion', 'mediaType', 'locale', 'summary', 'items', 'clientContext']);
  if (input.schemaVersion !== PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION) {
    throw new HttpError(400, 'Unsupported schema version.');
  }
  if (!RECO_MEDIA_TYPES.has(String(input.mediaType))) {
    throw new HttpError(400, 'Invalid recommendation media type.');
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > PUBLIC_RECOMMENDATION_MAX_ITEMS) {
    throw new HttpError(400, 'Invalid recommendation items.');
  }

  const mediaType = input.mediaType as PublicRecommendationMediaType;
  const inputItems = input.items as unknown[];
  const ranks = new Set<number>();
  const items = inputItems.map((raw, index) => {
    assertRecord(raw, 'recommendation item');
    assertExactKeys(raw, ['rank', 'score', 'provider', 'providerItemId', 'mediaType', 'title', 'artists', 'album', 'imageUrl', 'reason', 'durationMs', 'releaseDate', 'explicit']);
    if (!PROVIDERS.has(String(raw.provider))) throw new HttpError(400, 'Invalid recommendation provider.');
    if (!ITEM_MEDIA_TYPES.has(String(raw.mediaType))) throw new HttpError(400, 'Invalid recommendation item media type.');
    if (mediaType !== 'mixed' && raw.mediaType !== mediaType) throw new HttpError(400, 'Recommendation item media type does not match list media type.');
    const rank = raw.rank === undefined ? index + 1 : requireInteger(raw.rank, 'rank');
    if (rank < 1 || rank > inputItems.length || ranks.has(rank)) throw new HttpError(400, 'Invalid recommendation rank.');
    ranks.add(rank);
    const providerItemId = normalizeRequiredString(raw.providerItemId, 'providerItemId', 300);
    validateProviderItemId(raw.provider as PublicRecommendationProvider, providerItemId);
    const score = raw.score === undefined ? undefined : requireFiniteNumber(raw.score, 'score', 0, 1);
    const title = raw.title === undefined ? undefined : normalizeOptionalString(raw.title, 'title', PUBLIC_RECOMMENDATION_MAX_TITLE_LENGTH);
    const reason = raw.reason === undefined ? undefined : normalizeOptionalString(raw.reason, 'reason', PUBLIC_RECOMMENDATION_MAX_REASON_LENGTH);
    const imageUrl = raw.imageUrl === undefined ? undefined : validateHttpsUrl(raw.imageUrl, 'imageUrl');
    const durationMs = raw.durationMs === undefined ? undefined : requireIntegerInRange(raw.durationMs, 'durationMs', 0, 24 * 60 * 60 * 1000);
    const releaseDate = raw.releaseDate === undefined ? undefined : normalizeOptionalString(raw.releaseDate, 'releaseDate', 40);
    const explicit = raw.explicit === undefined ? undefined : requireBoolean(raw.explicit, 'explicit');
    const artists = raw.artists === undefined ? undefined : normalizeArtists(raw.artists);
    const album = raw.album === undefined ? undefined : normalizeAlbum(raw.album);
    return { rank, originalIndex: index, score, provider: raw.provider as PublicRecommendationProvider, providerItemId, mediaType: raw.mediaType as PublicRecommendationItemMediaType, title, artists, album, imageUrl, reason, durationMs, releaseDate, explicit };
  }).sort((a, b) => a.rank - b.rank || a.originalIndex - b.originalIndex);

  const normalized = {
    schemaVersion: PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION,
    mediaType,
    locale: input.locale === undefined ? undefined : normalizeLocale(input.locale),
    summary: input.summary === undefined ? undefined : normalizeOptionalString(input.summary, 'summary', PUBLIC_RECOMMENDATION_MAX_SUMMARY_LENGTH),
    items,
    clientContext: input.clientContext === undefined ? undefined : normalizeClientContext(input.clientContext),
  };
  return { ...normalized, requestHash: hashPublicWriteRequest(normalized) };
}

export function normalizePublicTasteProfileInput(input: unknown): NormalizedPublicTasteProfileInput {
  assertRecord(input, 'request body');
  assertExactKeys(input, ['schemaVersion', 'summary', 'locale', 'signals', 'clientContext']);
  if (input.schemaVersion !== PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION) throw new HttpError(400, 'Unsupported schema version.');
  if (!Array.isArray(input.signals) || input.signals.length < 1 || input.signals.length > PUBLIC_TASTE_MAX_SIGNALS) throw new HttpError(400, 'Invalid taste signals.');
  const seen = new Set<string>();
  const signals = input.signals.map((raw) => {
    assertRecord(raw, 'taste signal');
    assertExactKeys(raw, ['kind', 'key', 'provider', 'providerItemId', 'label', 'weight', 'confidence']);
    if (!TASTE_SIGNAL_KINDS.has(String(raw.kind))) throw new HttpError(400, 'Invalid taste signal kind.');
    const kind = raw.kind as PublicTasteSignalKind;
    const key = raw.key === undefined ? undefined : normalizeOptionalString(raw.key, 'key', PUBLIC_TASTE_MAX_SIGNAL_KEY_LENGTH);
    const label = raw.label === undefined ? undefined : normalizeOptionalString(raw.label, 'label', PUBLIC_TASTE_MAX_SIGNAL_LABEL_LENGTH);
    const provider = raw.provider === undefined ? undefined : raw.provider as PublicRecommendationProvider;
    if (provider !== undefined && !PROVIDERS.has(provider)) throw new HttpError(400, 'Invalid taste signal provider.');
    const providerItemId = raw.providerItemId === undefined ? undefined : normalizeRequiredString(raw.providerItemId, 'providerItemId', 300);
    if (provider && providerItemId) validateProviderItemId(provider, providerItemId);
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
    schemaVersion: PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION,
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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, `Invalid ${name}.`);
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new HttpError(400, `Unknown field: ${key}`);
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

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new HttpError(400, `Invalid ${field}.`);
  return value;
}

function requireIntegerInRange(value: unknown, field: string, min: number, max: number): number {
  const n = requireInteger(value, field);
  if (n < min || n > max) throw new HttpError(400, `Invalid ${field}.`);
  return n;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `Invalid ${field}.`);
  return value;
}

function normalizeLocale(value: unknown): string {
  const locale = normalizeRequiredString(value, 'locale', 35);
  if (!/^[a-zA-Z]{2,3}([_-][a-zA-Z0-9]{2,8})*$/.test(locale)) throw new HttpError(400, 'Invalid locale.');
  return locale;
}

function validateHttpsUrl(value: unknown, field: string): string {
  const url = normalizeRequiredString(value, field, 2048);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('not https');
    return url;
  } catch {
    throw new HttpError(400, `Invalid ${field}.`);
  }
}

function normalizeClientContext(value: unknown): Record<string, unknown> {
  assertRecord(value, 'clientContext');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 8 * 1024) throw new HttpError(400, 'clientContext too large.');
  return value;
}

function normalizeArtists(value: unknown): Array<{ name: string; providerArtistId?: string }> {
  if (!Array.isArray(value) || value.length > 10) throw new HttpError(400, 'Invalid artists.');
  return value.map((raw) => {
    assertRecord(raw, 'artist');
    assertExactKeys(raw, ['name', 'providerArtistId']);
    return {
      name: normalizeRequiredString(raw.name, 'artist.name', 200),
      providerArtistId: raw.providerArtistId === undefined ? undefined : normalizeOptionalString(raw.providerArtistId, 'artist.providerArtistId', 300),
    };
  });
}

function normalizeAlbum(value: unknown): { title?: string; providerAlbumId?: string } {
  assertRecord(value, 'album');
  assertExactKeys(value, ['title', 'providerAlbumId']);
  return {
    title: value.title === undefined ? undefined : normalizeOptionalString(value.title, 'album.title', 300),
    providerAlbumId: value.providerAlbumId === undefined ? undefined : normalizeOptionalString(value.providerAlbumId, 'album.providerAlbumId', 300),
  };
}

function validateProviderItemId(provider: PublicRecommendationProvider, id: string): void {
  if (provider === 'custom') {
    if (!/^custom:[a-z0-9._-]{1,64}:[a-zA-Z0-9._:-]{1,160}$/.test(id)) throw new HttpError(400, 'Invalid custom providerItemId.');
    return;
  }
  if (!/^[a-zA-Z0-9._:-]{1,300}$/.test(id)) throw new HttpError(400, 'Invalid providerItemId.');
}
