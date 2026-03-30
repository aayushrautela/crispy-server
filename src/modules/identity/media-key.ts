import { HttpError } from '../../lib/errors.js';

export type SupportedProvider = 'tmdb' | 'tvdb' | 'kitsu';

export type SupportedMediaType = 'movie' | 'show' | 'anime' | 'season' | 'episode';

export type CanonicalContentEntityType = SupportedMediaType | 'person';

export type MediaIdentity = {
  contentId?: string | null;
  mediaKey: string;
  mediaType: SupportedMediaType;
  provider?: SupportedProvider | null;
  providerId?: string | null;
  parentContentId?: string | null;
  parentProvider?: SupportedProvider | null;
  parentProviderId?: string | null;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber?: number | null;
  providerMetadata?: Record<string, unknown>;
};

export function ensureSupportedMediaType(value: string): SupportedMediaType {
  if (value === 'movie' || value === 'show' || value === 'anime' || value === 'season' || value === 'episode') {
    return value;
  }

  throw new HttpError(400, 'Unsupported media type.');
}

export function ensureSupportedProvider(value: string): SupportedProvider {
  if (value === 'tmdb' || value === 'tvdb' || value === 'kitsu') {
    return value;
  }

  throw new HttpError(400, 'Unsupported metadata provider.');
}

export function authorityProviderForEntityType(
  entityType: CanonicalContentEntityType,
  parentMediaType: 'show' | 'anime' | null = null,
): SupportedProvider {
  if (entityType === 'movie' || entityType === 'person') {
    return 'tmdb';
  }

  if (entityType === 'show') {
    return 'tvdb';
  }

  if (entityType === 'anime') {
    return 'kitsu';
  }

  if (parentMediaType === 'anime') {
    return 'kitsu';
  }

  if (parentMediaType === 'show') {
    return 'tvdb';
  }

  throw new HttpError(400, 'Unable to infer authority provider.');
}

export function authorityProviderForMediaType(
  mediaType: SupportedMediaType,
  parentMediaType: 'show' | 'anime' | null = null,
): SupportedProvider {
  return authorityProviderForEntityType(mediaType, parentMediaType);
}

export function showTmdbIdForIdentity(identity: MediaIdentity): number | null {
  if (identity.showTmdbId) {
    return identity.showTmdbId;
  }

  if (identity.mediaType === 'show' && identity.provider === 'tmdb') {
    return identity.tmdbId;
  }

  if ((identity.mediaType === 'season' || identity.mediaType === 'episode') && identity.parentProvider === 'tmdb') {
    return identity.showTmdbId;
  }

  return null;
}

export function canonicalContinueWatchingMediaKey(identity: MediaIdentity): string {
  if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return identity.mediaKey;
  }

  if ((!identity.parentProviderId || !identity.parentProvider) && identity.mediaKey) {
    const parsed = parseMediaKey(identity.mediaKey);
    return canonicalContinueWatchingMediaKey({
      ...parsed,
      ...identity,
      parentProvider: identity.parentProvider ?? parsed.parentProvider,
      parentProviderId: identity.parentProviderId ?? parsed.parentProviderId,
    });
  }

  const parentProvider = identity.parentProvider ?? identity.provider;
  const parentProviderId = identity.parentProviderId;
  if (parentProviderId) {
    return `${parentMediaTypeForIdentity(identity)}:${parentProvider}:${parentProviderId}`;
  }

  throw new HttpError(400, 'Unable to infer canonical continue watching media key.');
}

export function parseMediaKey(mediaKey: string): MediaIdentity {
  const parts = mediaKey.split(':');
  if (parts.length < 3) {
    throw new HttpError(400, 'Unsupported media key format.');
  }

  const mediaType = ensureSupportedMediaType(parts[0] ?? '');
  const provider = ensureSupportedProvider(parts[1] ?? '');
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime') {
    const providerId = parseProviderId(parts[2], 'Invalid provider id in media key.');
    return createMediaIdentity({
      mediaKey,
      mediaType,
      provider,
      providerId,
    });
  }

  if (mediaType === 'season' && parts.length === 4) {
    const parentProviderId = parseProviderId(parts[2], 'Invalid parent provider id in media key.');
    const seasonNumber = parseNonNegativeInteger(parts[3], 'Invalid season media key.');
    return createMediaIdentity({
      mediaKey,
      mediaType,
      provider,
      providerId: buildSeasonProviderId(parentProviderId, seasonNumber),
      parentProvider: provider,
      parentProviderId,
      seasonNumber,
    });
  }

  if (mediaType === 'episode' && parts.length === 5) {
    const parentProviderId = parseProviderId(parts[2], 'Invalid parent provider id in media key.');
    const seasonNumber = parseNonNegativeInteger(parts[3], 'Invalid episode media key.');
    const episodeNumber = parsePositiveInteger(parts[4], 'Invalid episode media key.');
    return createMediaIdentity({
      mediaKey,
      mediaType,
      provider,
      providerId: buildEpisodeProviderId(parentProviderId, seasonNumber, episodeNumber),
      parentProvider: provider,
      parentProviderId,
      seasonNumber,
      episodeNumber,
      absoluteEpisodeNumber: provider === 'kitsu' ? episodeNumber : null,
    });
  }

  if (mediaType === 'episode' && parts.length === 4) {
    const parentProviderId = parseProviderId(parts[2], 'Invalid parent provider id in media key.');
    const absoluteEpisodeNumber = parsePositiveInteger(parts[3], 'Invalid episode media key.');
    return createMediaIdentity({
      mediaKey,
      mediaType,
      provider,
      providerId: buildAbsoluteEpisodeProviderId(parentProviderId, absoluteEpisodeNumber),
      parentProvider: provider,
      parentProviderId,
      seasonNumber: null,
      episodeNumber: absoluteEpisodeNumber,
      absoluteEpisodeNumber,
    });
  }

  throw new HttpError(400, 'Unsupported media key format.');
}

export function inferMediaIdentity(input: {
  contentId?: string | null;
  mediaKey?: string;
  mediaType: string;
  provider?: SupportedProvider | null;
  providerId?: string | number | null;
  parentContentId?: string | null;
  parentProvider?: SupportedProvider | null;
  parentProviderId?: string | number | null;
  absoluteEpisodeNumber?: number | null;
  providerMetadata?: Record<string, unknown>;
  tmdbId?: number | null;
  tvdbId?: number | string | null;
  kitsuId?: number | string | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): MediaIdentity {
  if (input.mediaKey?.trim()) {
    const parsed = parseMediaKey(input.mediaKey.trim());
    return {
      ...parsed,
      contentId: normalizeNullableString(input.contentId) ?? parsed.contentId,
      parentContentId: normalizeNullableString(input.parentContentId) ?? parsed.parentContentId,
      provider: input.provider ?? parsed.provider,
      providerId: normalizeProviderId(input.providerId) ?? parsed.providerId,
      parentProvider: input.parentProvider ?? parsed.parentProvider,
      parentProviderId: normalizeProviderId(input.parentProviderId) ?? parsed.parentProviderId,
      seasonNumber: input.seasonNumber ?? parsed.seasonNumber,
      episodeNumber: input.episodeNumber ?? parsed.episodeNumber,
      absoluteEpisodeNumber: input.absoluteEpisodeNumber ?? parsed.absoluteEpisodeNumber,
      providerMetadata: input.providerMetadata ?? parsed.providerMetadata,
      tmdbId: input.tmdbId ?? parsed.tmdbId,
      showTmdbId: input.showTmdbId ?? parsed.showTmdbId,
    };
  }

  const mediaType = ensureSupportedMediaType(input.mediaType);
  const normalizedProviderId = resolveProviderId(input, mediaType);
  const normalizedProvider = resolveProvider(input, mediaType, normalizedProviderId.providerSource);

  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime') {
    return createMediaIdentity({
      contentId: normalizeNullableString(input.contentId),
      mediaType,
      provider: normalizedProvider,
      providerId: normalizedProviderId.providerId,
      providerMetadata: input.providerMetadata,
    });
  }

  if (
    mediaType === 'season' &&
    normalizedProviderId.parentProviderId &&
    input.seasonNumber !== undefined &&
    input.seasonNumber !== null
  ) {
    return createMediaIdentity({
      contentId: normalizeNullableString(input.contentId),
      parentContentId: normalizeNullableString(input.parentContentId),
      mediaType,
      provider: normalizedProvider,
      providerId: buildSeasonProviderId(normalizedProviderId.parentProviderId, input.seasonNumber),
      parentProvider: input.parentProvider ?? normalizedProvider,
      parentProviderId: normalizedProviderId.parentProviderId,
      seasonNumber: input.seasonNumber,
      providerMetadata: input.providerMetadata,
    });
  }

  if (input.mediaType === 'show' && input.tmdbId) {
    return createMediaIdentity({
      contentId: normalizeNullableString(input.contentId),
      mediaType: 'show',
      provider: 'tmdb',
      providerId: String(input.tmdbId),
      providerMetadata: input.providerMetadata,
    });
  }

  if (
    mediaType === 'episode' &&
    normalizedProviderId.parentProviderId &&
    input.seasonNumber !== undefined &&
    input.seasonNumber !== null &&
    input.episodeNumber !== undefined &&
    input.episodeNumber !== null
  ) {
    return createMediaIdentity({
      contentId: normalizeNullableString(input.contentId),
      parentContentId: normalizeNullableString(input.parentContentId),
      mediaType,
      provider: normalizedProvider,
      providerId: buildEpisodeProviderId(normalizedProviderId.parentProviderId, input.seasonNumber, input.episodeNumber),
      parentProvider: input.parentProvider ?? normalizedProvider,
      parentProviderId: normalizedProviderId.parentProviderId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      absoluteEpisodeNumber: input.absoluteEpisodeNumber ?? null,
      providerMetadata: input.providerMetadata,
    });
  }

  if (
    mediaType === 'episode' &&
    normalizedProviderId.parentProviderId &&
    (input.absoluteEpisodeNumber !== undefined && input.absoluteEpisodeNumber !== null)
  ) {
    return createMediaIdentity({
      contentId: normalizeNullableString(input.contentId),
      parentContentId: normalizeNullableString(input.parentContentId),
      mediaType,
      provider: normalizedProvider,
      providerId: buildAbsoluteEpisodeProviderId(normalizedProviderId.parentProviderId, input.absoluteEpisodeNumber),
      parentProvider: input.parentProvider ?? normalizedProvider,
      parentProviderId: normalizedProviderId.parentProviderId,
      seasonNumber: input.seasonNumber ?? null,
      episodeNumber: input.episodeNumber ?? input.absoluteEpisodeNumber,
      absoluteEpisodeNumber: input.absoluteEpisodeNumber,
      providerMetadata: input.providerMetadata,
    });
  }

  throw new HttpError(400, 'Unable to infer media identity.');
}

export function parentMediaTypeForIdentity(identity: Pick<MediaIdentity, 'mediaType' | 'provider' | 'parentProvider'>): 'movie' | 'show' | 'anime' {
  if (identity.mediaType === 'movie') {
    return 'movie';
  }

  if (identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return identity.mediaType;
  }

  const provider = identity.parentProvider ?? identity.provider;
  return provider === 'kitsu' ? 'anime' : 'show';
}

export function buildSeasonProviderId(parentProviderId: string, seasonNumber: number): string {
  return `${parentProviderId}:s${seasonNumber}`;
}

export function buildEpisodeProviderId(parentProviderId: string, seasonNumber: number, episodeNumber: number): string {
  return `${parentProviderId}:s${seasonNumber}:e${episodeNumber}`;
}

export function buildAbsoluteEpisodeProviderId(parentProviderId: string, absoluteEpisodeNumber: number): string {
  return `${parentProviderId}:a${absoluteEpisodeNumber}`;
}

function createMediaIdentity(input: {
  contentId?: string | null;
  mediaKey?: string;
  mediaType: SupportedMediaType;
  provider: SupportedProvider;
  providerId: string;
  parentContentId?: string | null;
  parentProvider?: SupportedProvider | null;
  parentProviderId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
  providerMetadata?: Record<string, unknown>;
}): MediaIdentity {
  const mediaKey = input.mediaKey ?? buildMediaKey(input);
  const providerMetadata = input.providerMetadata ?? {};
  const tmdbId = deriveTmdbId(input.provider, input.providerId, providerMetadata);
  const showTmdbId = deriveShowTmdbId(input.parentProvider ?? null, input.parentProviderId ?? null, input.mediaType, input.provider, input.providerId);

  return {
    contentId: input.contentId ?? null,
    mediaKey,
    mediaType: input.mediaType,
    provider: input.provider,
    providerId: input.providerId,
    parentContentId: input.parentContentId ?? null,
    parentProvider: input.parentProvider ?? null,
    parentProviderId: input.parentProviderId ?? null,
    tmdbId,
    showTmdbId,
    seasonNumber: input.seasonNumber ?? null,
    episodeNumber: input.episodeNumber ?? null,
    absoluteEpisodeNumber: input.absoluteEpisodeNumber ?? null,
    providerMetadata,
  };
}

function buildMediaKey(input: {
  mediaType: SupportedMediaType;
  provider: SupportedProvider;
  providerId: string;
  parentProviderId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
}): string {
  if (input.mediaType === 'movie' || input.mediaType === 'show' || input.mediaType === 'anime') {
    return `${input.mediaType}:${input.provider}:${input.providerId}`;
  }

  if (input.mediaType === 'season' && input.parentProviderId && input.seasonNumber !== null && input.seasonNumber !== undefined) {
    return `season:${input.provider}:${input.parentProviderId}:${input.seasonNumber}`;
  }

  if (
    input.mediaType === 'episode'
    && input.parentProviderId
    && input.seasonNumber !== null
    && input.seasonNumber !== undefined
    && input.episodeNumber !== null
    && input.episodeNumber !== undefined
  ) {
    return `episode:${input.provider}:${input.parentProviderId}:${input.seasonNumber}:${input.episodeNumber}`;
  }

  if (input.mediaType === 'episode' && input.parentProviderId && input.absoluteEpisodeNumber) {
    return `episode:${input.provider}:${input.parentProviderId}:${input.absoluteEpisodeNumber}`;
  }

  throw new HttpError(400, 'Unable to infer media key.');
}

function resolveProvider(
  input: {
    provider?: SupportedProvider | null;
    parentProvider?: SupportedProvider | null;
  },
  mediaType: SupportedMediaType,
  providerSource: 'direct' | 'tmdb' | 'tvdb' | 'kitsu' | 'parent',
): SupportedProvider {
  if (providerSource === 'direct' && input.provider) {
    return input.provider;
  }

  if (providerSource === 'tmdb') {
    return 'tmdb';
  }

  if (providerSource === 'tvdb') {
    return 'tvdb';
  }

  if (providerSource === 'kitsu') {
    return 'kitsu';
  }

  if (providerSource === 'parent' && input.parentProvider) {
    return input.parentProvider;
  }

  if (mediaType === 'episode' || mediaType === 'season') {
    return authorityProviderForMediaType(mediaType, input.parentProvider === 'kitsu' ? 'anime' : 'show');
  }

  return authorityProviderForMediaType(mediaType);
}

function resolveProviderId(input: {
  providerId?: string | number | null;
  parentProviderId?: string | number | null;
  tmdbId?: number | null;
  tvdbId?: number | string | null;
  kitsuId?: number | string | null;
  showTmdbId?: number | null;
}, mediaType: SupportedMediaType): {
  providerId: string;
  parentProviderId: string | null;
  providerSource: 'direct' | 'tmdb' | 'tvdb' | 'kitsu' | 'parent';
} {
  const providerId = normalizeProviderId(input.providerId);
  const parentProviderId = normalizeProviderId(input.parentProviderId);
  if (providerId && mediaType !== 'season' && mediaType !== 'episode') {
    return { providerId, parentProviderId, providerSource: 'direct' };
  }

  if (providerId && (mediaType === 'season' || mediaType === 'episode')) {
    return { providerId, parentProviderId, providerSource: 'direct' };
  }

  if (typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
    return { providerId: String(input.tmdbId), parentProviderId, providerSource: 'tmdb' };
  }

  const tvdbId = normalizeProviderId(input.tvdbId);
  if (tvdbId) {
    return { providerId: tvdbId, parentProviderId, providerSource: 'tvdb' };
  }

  const kitsuId = normalizeProviderId(input.kitsuId);
  if (kitsuId) {
    return { providerId: kitsuId, parentProviderId, providerSource: 'kitsu' };
  }

  if (typeof input.showTmdbId === 'number' && Number.isInteger(input.showTmdbId) && input.showTmdbId > 0) {
    return { providerId: String(input.showTmdbId), parentProviderId: String(input.showTmdbId), providerSource: 'tmdb' };
  }

  if (parentProviderId) {
    return { providerId: parentProviderId, parentProviderId, providerSource: 'parent' };
  }

  throw new HttpError(400, 'Unable to infer provider identity.');
}

function normalizeProviderId(value: string | number | null | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return null;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseProviderId(value: string | undefined, message: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new HttpError(400, message);
}

function parsePositiveInteger(value: string | undefined, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, message);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, message);
  }
  return parsed;
}

function deriveTmdbId(
  provider: SupportedProvider,
  providerId: string,
  providerMetadata: Record<string, unknown>,
): number | null {
  if (provider === 'tmdb') {
    const parsed = Number(providerId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  const metadataTmdbId = Number(providerMetadata.tmdbId);
  return Number.isInteger(metadataTmdbId) && metadataTmdbId > 0 ? metadataTmdbId : null;
}

function deriveShowTmdbId(
  parentProvider: SupportedProvider | null,
  parentProviderId: string | null,
  mediaType: SupportedMediaType,
  provider: SupportedProvider,
  providerId: string,
): number | null {
  if (mediaType === 'show' && provider === 'tmdb') {
    const parsed = Number(providerId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  if ((mediaType === 'season' || mediaType === 'episode') && parentProvider === 'tmdb' && parentProviderId) {
    const parsed = Number(parentProviderId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}
