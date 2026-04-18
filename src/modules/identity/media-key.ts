import { HttpError } from '../../lib/errors.js';

export type SupportedProvider = 'tmdb';

export type SupportedMediaType = 'movie' | 'show' | 'season' | 'episode';

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
  if (value === 'movie' || value === 'show' || value === 'season' || value === 'episode') {
    return value;
  }

  throw new HttpError(400, 'Unsupported media type.');
}

export function ensureSupportedProvider(value: string): SupportedProvider {
  if (value === 'tmdb') {
    return value;
  }

  throw new HttpError(400, 'Unsupported metadata provider.');
}

export function authorityProviderForEntityType(
  entityType: CanonicalContentEntityType,
  _parentMediaType: 'show' | null = null,
): SupportedProvider {
  if (
    entityType === 'movie'
    || entityType === 'show'
    || entityType === 'season'
    || entityType === 'episode'
    || entityType === 'person'
  ) {
    return 'tmdb';
  }

  throw new HttpError(400, 'Unable to infer authority provider.');
}

export function authorityProviderForMediaType(
  mediaType: SupportedMediaType,
  parentMediaType: 'show' | null = null,
): SupportedProvider {
  return authorityProviderForEntityType(mediaType, parentMediaType);
}

export function showTmdbIdForIdentity(identity: MediaIdentity): number | null {
  if (identity.showTmdbId) {
    return identity.showTmdbId;
  }

  if (identity.mediaType === 'show' && identity.tmdbId) {
    return identity.tmdbId;
  }

  const parentTmdbId = parseOptionalPositiveInteger(identity.parentProviderId ?? null);
  return parentTmdbId;
}

export function canonicalContinueWatchingMediaKey(identity: MediaIdentity): string {
  if (identity.mediaType === 'movie' || identity.mediaType === 'show') {
    return identity.mediaKey;
  }

  const canonicalShowTmdbId = showTmdbIdForIdentity(identity)
    ?? (identity.mediaKey ? showTmdbIdForIdentity(parseMediaKey(identity.mediaKey)) : null);
  if (canonicalShowTmdbId) {
    return `show:tmdb:${canonicalShowTmdbId}`;
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
  assertProviderSupportsMediaType(mediaType, provider);
  if (mediaType === 'movie' || mediaType === 'show') {
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
  const normalizedProvider = resolveProvider(input, normalizedProviderId.providerSource);

  if (mediaType === 'movie' || mediaType === 'show') {
    return createMediaIdentity({
      contentId: normalizeNullableString(input.contentId),
      mediaType,
      provider: normalizedProvider,
      providerId: normalizedProviderId.providerId,
      providerMetadata: input.providerMetadata,
    });
  }

  if (
    mediaType === 'season'
    && normalizedProviderId.parentProviderId
    && input.seasonNumber !== undefined
    && input.seasonNumber !== null
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

  if (
    mediaType === 'episode'
    && normalizedProviderId.parentProviderId
    && input.seasonNumber !== undefined
    && input.seasonNumber !== null
    && input.episodeNumber !== undefined
    && input.episodeNumber !== null
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

  throw new HttpError(400, 'Unable to infer media identity.');
}

export function parentMediaTypeForIdentity(identity: Pick<MediaIdentity, 'mediaType'>): 'movie' | 'show' {
  if (identity.mediaType === 'movie') {
    return 'movie';
  }

  return 'show';
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
  assertProviderSupportsMediaType(input.mediaType, input.provider);
  const tmdbId = deriveTmdbId(input.mediaType, input.providerId, providerMetadata);
  const showTmdbId = deriveShowTmdbId(
    input.parentProviderId ?? null,
    input.mediaType,
    input.providerId,
    providerMetadata,
  );

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
}): string {
  if (input.mediaType === 'movie' || input.mediaType === 'show') {
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

  throw new HttpError(400, 'Unable to infer media key.');
}

function resolveProvider(
  input: {
    provider?: SupportedProvider | null;
    parentProvider?: SupportedProvider | null;
  },
  providerSource: 'direct' | 'tmdb' | 'parent',
): SupportedProvider {
  if (providerSource === 'direct' && input.provider) {
    return input.provider;
  }

  if (providerSource === 'parent' && input.parentProvider) {
    return input.parentProvider;
  }

  return 'tmdb';
}

function resolveProviderId(
  input: {
    providerId?: string | number | null;
    parentProviderId?: string | number | null;
    tmdbId?: number | null;
    tvdbId?: number | string | null;
    kitsuId?: number | string | null;
    showTmdbId?: number | null;
  },
  mediaType: SupportedMediaType,
): {
  providerId: string;
  parentProviderId: string | null;
  providerSource: 'direct' | 'tmdb' | 'parent';
} {
  const providerId = normalizeProviderId(input.providerId);
  const parentProviderId = normalizeProviderId(input.parentProviderId)
    ?? normalizeProviderId(input.showTmdbId)
    ?? ((mediaType === 'season' || mediaType === 'episode') ? normalizeProviderId(input.tmdbId) : null);

  if (providerId && mediaType !== 'season' && mediaType !== 'episode') {
    return { providerId, parentProviderId, providerSource: 'direct' };
  }

  if (providerId && (mediaType === 'season' || mediaType === 'episode')) {
    return { providerId, parentProviderId, providerSource: 'direct' };
  }

  if (typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
    return {
      providerId: String(input.tmdbId),
      parentProviderId: mediaType === 'season' || mediaType === 'episode' ? String(input.tmdbId) : parentProviderId,
      providerSource: 'tmdb',
    };
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

function parseOptionalPositiveInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function deriveTmdbId(
  mediaType: SupportedMediaType,
  providerId: string,
  providerMetadata: Record<string, unknown>,
): number | null {
  if (mediaType === 'movie' || mediaType === 'show') {
    const parsed = Number(providerId);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const metadataTmdbId = Number(providerMetadata.tmdbId);
  return Number.isInteger(metadataTmdbId) && metadataTmdbId > 0 ? metadataTmdbId : null;
}

function deriveShowTmdbId(
  parentProviderId: string | null,
  mediaType: SupportedMediaType,
  providerId: string,
  providerMetadata: Record<string, unknown>,
): number | null {
  const metadataShowTmdbId = Number(providerMetadata.showTmdbId ?? providerMetadata.tmdbId);
  if (Number.isInteger(metadataShowTmdbId) && metadataShowTmdbId > 0) {
    return metadataShowTmdbId;
  }

  if (mediaType === 'show') {
    const parsed = Number(providerId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  if ((mediaType === 'season' || mediaType === 'episode') && parentProviderId) {
    const parsed = Number(parentProviderId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function assertProviderSupportsMediaType(mediaType: SupportedMediaType, provider: SupportedProvider): void {
  if (provider === 'tmdb') {
    return;
  }

  throw new HttpError(400, `Unsupported ${mediaType} provider.`);
}
