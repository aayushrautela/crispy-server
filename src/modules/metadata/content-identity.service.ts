import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import {
  authorityProviderForEntityType,
  buildAbsoluteEpisodeProviderId,
  buildEpisodeProviderId,
  buildSeasonProviderId,
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  type MediaIdentity,
  type SupportedProvider,
} from '../watch/media-key.js';
import {
  ContentIdentityRepository,
  type ContentEntityType,
  type ContentProviderRefInput,
  type ContentProviderRefRecord,
} from './content-identity.repo.js';

type TitleMediaType = 'movie' | 'show' | 'anime';
type ParentMediaType = 'show' | 'anime';

export type CanonicalContentReference =
  | {
      contentId: string;
      entityType: TitleMediaType | 'episode';
      mediaIdentity: MediaIdentity;
    }
  | {
      contentId: string;
      entityType: 'season';
      parentMediaType: ParentMediaType;
      provider: SupportedProvider;
      providerId: string;
      parentProviderId: string;
      seasonNumber: number;
    }
  | {
      contentId: string;
      entityType: 'person';
      tmdbPersonId: number;
    };

export type TitleIdentityInput = {
  mediaType: TitleMediaType;
  provider?: SupportedProvider;
  providerId: string | number;
  metadata?: Record<string, unknown>;
};

export type EpisodeIdentityInput = {
  parentMediaType: ParentMediaType;
  provider?: SupportedProvider;
  parentProviderId: string | number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
  metadata?: Record<string, unknown>;
};

export type SeasonIdentityInput = {
  parentMediaType: ParentMediaType;
  provider?: SupportedProvider;
  parentProviderId: string | number;
  seasonNumber: number;
  metadata?: Record<string, unknown>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ContentIdentityService {
  constructor(private readonly repository = new ContentIdentityRepository()) {}

  async ensureContentId(client: DbClient, identity: MediaIdentity): Promise<string> {
    if (identity.contentId && UUID_RE.test(identity.contentId.trim())) {
      return normalizeContentId(identity.contentId);
    }

    if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
      return this.ensureTitleContentId(client, {
        mediaType: identity.mediaType,
        provider: identity.provider ?? authorityProviderForEntityType(identity.mediaType),
        providerId: identity.providerId ?? identity.tmdbId ?? identity.mediaKey,
        metadata: identity.providerMetadata,
      });
    }

    if (identity.mediaType === 'season') {
      if (!identity.parentProviderId || identity.seasonNumber === null) {
        throw new HttpError(400, 'Unable to resolve canonical content id.');
      }

      return this.ensureSeasonContentId(client, {
        parentMediaType: resolveParentMediaType(identity),
        provider: identity.provider ?? authorityProviderForEntityType('season', resolveParentMediaType(identity)),
        parentProviderId: identity.parentProviderId,
        seasonNumber: identity.seasonNumber,
        metadata: identity.providerMetadata,
      });
    }

    if (!identity.parentProviderId) {
      throw new HttpError(400, 'Unable to resolve canonical content id.');
    }

    return this.ensureEpisodeContentId(client, {
      parentMediaType: resolveParentMediaType(identity),
      provider: identity.provider ?? authorityProviderForEntityType('episode', resolveParentMediaType(identity)),
      parentProviderId: identity.parentProviderId,
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
      absoluteEpisodeNumber: identity.absoluteEpisodeNumber,
      metadata: identity.providerMetadata,
    });
  }

  async ensureContentIds(client: DbClient, identities: MediaIdentity[]): Promise<Map<string, string>> {
    const requested = identities.flatMap((identity) => {
      try {
        return canMaterializeIdentity(identity)
          ? [{ mediaKey: identity.mediaKey, ref: toProviderRef(identity) }]
          : [];
      } catch {
        return [];
      }
    });

    const records = await this.ensureProviderRefRecords(
      client,
      requested.map((entry) => entry.ref),
    );

    const resolved = new Map<string, string>();
    for (const [index, entry] of requested.entries()) {
      const record = records[index];
      if (record?.contentId) {
        resolved.set(entry.mediaKey, record.contentId);
      }
    }

    return resolved;
  }

  async ensureTitleContentId(client: DbClient, input: TitleIdentityInput): Promise<string> {
    const [record] = await this.ensureProviderRefRecords(client, [toTitleRef(input)]);
    return assertContentId(record);
  }

  async ensureTitleContentIds(client: DbClient, inputs: TitleIdentityInput[]): Promise<Map<string, string>> {
    const records = await this.ensureProviderRefRecords(client, inputs.map((input) => toTitleRef(input)));
    return new Map(records.map((record) => [titleRefMapKey(record.entityType as TitleMediaType, record.externalId), record.contentId]));
  }

  async ensureEpisodeContentId(client: DbClient, input: EpisodeIdentityInput): Promise<string> {
    const [record] = await this.ensureProviderRefRecords(client, [toEpisodeRef(input)]);
    return assertContentId(record);
  }

  async ensureEpisodeContentIds(client: DbClient, inputs: EpisodeIdentityInput[]): Promise<Map<string, string>> {
    const records = await this.ensureProviderRefRecords(client, inputs.map((input) => toEpisodeRef(input)));
    return new Map(records.map((record) => [record.externalId, record.contentId]));
  }

  async ensureSeasonContentId(client: DbClient, input: SeasonIdentityInput): Promise<string> {
    const [record] = await this.ensureProviderRefRecords(client, [toSeasonRef(input)]);
    return assertContentId(record);
  }

  async ensureSeasonContentIds(
    client: DbClient,
    input: Omit<SeasonIdentityInput, 'seasonNumber'>,
    seasonNumbers: number[],
  ): Promise<Map<number, string>> {
    const records = await this.ensureProviderRefRecords(
      client,
      seasonNumbers.map((seasonNumber) => toSeasonRef({
        ...input,
        seasonNumber,
      })),
    );

    return new Map(
      records.map((record) => {
        const { seasonNumber } = parseSeasonExternalId(record.provider as SupportedProvider, record.externalId, record.metadata);
        return [seasonNumber, record.contentId] as const;
      }),
    );
  }

  async ensurePersonContentId(client: DbClient, tmdbPersonId: number): Promise<string> {
    const [record] = await this.ensureProviderRefRecords(client, [toPersonRef(tmdbPersonId)]);
    return assertContentId(record);
  }

  private async ensureProviderRefRecords(
    client: DbClient,
    refs: ContentProviderRefInput[],
  ): Promise<ContentProviderRefRecord[]> {
    const requested = dedupeProviderRefs(refs);
    if (!requested.length) {
      return [];
    }

    const resolved = new Map<string, ContentProviderRefRecord>();
    const initial = await this.repository.ensureProviderRefs(client, requested);
    for (const record of initial) {
      resolved.set(providerRefKey(record.provider, record.entityType, record.externalId), record);
    }

    const missing = requested.filter((ref) => !resolved.has(providerRefKey(ref.provider, ref.entityType, ref.externalId)));
    for (const ref of missing) {
      try {
        const [record] = await this.repository.ensureProviderRefs(client, [ref]);
        if (record?.contentId) {
          resolved.set(providerRefKey(record.provider, record.entityType, record.externalId), record);
        }
      } catch {
        continue;
      }
    }

    return requested.flatMap((ref) => {
      const record = resolved.get(providerRefKey(ref.provider, ref.entityType, ref.externalId));
      return record ? [record] : [];
    });
  }

  async resolveMediaIdentity(client: DbClient, contentId: string): Promise<MediaIdentity> {
    const reference = await this.resolveContentReference(client, contentId);
    if (reference.entityType === 'season' || reference.entityType === 'person') {
      throw new HttpError(400, 'Invalid metadata id.');
    }
    return reference.mediaIdentity;
  }

  async resolveSeasonReference(
    client: DbClient,
    contentId: string,
  ): Promise<{ parentMediaType: ParentMediaType; provider: SupportedProvider; providerId: string; parentProviderId: string; seasonNumber: number }> {
    const reference = await this.resolveContentReference(client, contentId);
    if (reference.entityType !== 'season') {
      throw new HttpError(400, 'Invalid season id.');
    }

    return {
      parentMediaType: reference.parentMediaType,
      provider: reference.provider,
      providerId: reference.providerId,
      parentProviderId: reference.parentProviderId,
      seasonNumber: reference.seasonNumber,
    };
  }

  async resolvePersonTmdbId(client: DbClient, contentId: string): Promise<number> {
    const trimmed = contentId.trim();
    const direct = Number(trimmed);
    if (Number.isInteger(direct) && direct > 0) {
      return direct;
    }

    const reference = await this.resolveContentReference(client, trimmed);
    if (reference.entityType !== 'person') {
      throw new HttpError(400, 'Invalid person id.');
    }
    return reference.tmdbPersonId;
  }

  async resolveContentReference(client: DbClient, contentId: string): Promise<CanonicalContentReference> {
    const normalized = normalizeContentId(contentId);
    const item = await this.repository.findContentItemById(client, normalized);
    if (!item) {
      throw new HttpError(404, 'Metadata not found.');
    }

    const refs = await this.repository.listProviderRefsByContentId(client, normalized);
    if (!refs.length) {
      throw new HttpError(404, 'Metadata not found.');
    }

    const authorityRef = selectAuthorityRef(item.entityType, refs);
    if (!authorityRef) {
      throw new HttpError(404, 'Metadata not found.');
    }

    if (authorityRef.entityType === 'movie' || authorityRef.entityType === 'show' || authorityRef.entityType === 'anime') {
      return {
        contentId: normalized,
        entityType: authorityRef.entityType,
        mediaIdentity: inferMediaIdentity({
          contentId: normalized,
          mediaType: authorityRef.entityType,
          provider: authorityRef.provider as SupportedProvider,
          providerId: authorityRef.externalId,
          providerMetadata: authorityRef.metadata,
        }),
      };
    }

    if (authorityRef.entityType === 'episode') {
      const parsed = parseEpisodeExternalId(authorityRef.provider as SupportedProvider, authorityRef.externalId, authorityRef.metadata);
      return {
        contentId: normalized,
        entityType: 'episode',
        mediaIdentity: inferMediaIdentity({
          contentId: normalized,
          mediaType: 'episode',
          provider: authorityRef.provider as SupportedProvider,
          parentProvider: authorityRef.provider as SupportedProvider,
          parentProviderId: parsed.parentProviderId,
          seasonNumber: parsed.seasonNumber,
          episodeNumber: parsed.episodeNumber,
          absoluteEpisodeNumber: parsed.absoluteEpisodeNumber,
          providerMetadata: authorityRef.metadata,
        }),
      };
    }

    if (authorityRef.entityType === 'season') {
      const parsed = parseSeasonExternalId(authorityRef.provider as SupportedProvider, authorityRef.externalId, authorityRef.metadata);
      return {
        contentId: normalized,
        entityType: 'season',
        parentMediaType: parsed.parentMediaType,
        provider: authorityRef.provider as SupportedProvider,
        providerId: authorityRef.externalId,
        parentProviderId: parsed.parentProviderId,
        seasonNumber: parsed.seasonNumber,
      };
    }

    return {
      contentId: normalized,
      entityType: 'person',
      tmdbPersonId: parsePositiveInteger(authorityRef.externalId, 'Invalid person id.'),
    };
  }
}

export function titleRefMapKey(mediaType: TitleMediaType, providerId: string | number): string {
  return `${mediaType}:${normalizeIdentifier(providerId, 'Invalid provider id.')}`;
}

export function episodeRefMapKey(
  parentProviderId: string | number,
  seasonNumber: number | null,
  episodeNumber: number | null,
  absoluteEpisodeNumber: number | null = null,
): string {
  const normalizedParentProviderId = normalizeIdentifier(parentProviderId, 'Invalid provider id.');
  if (seasonNumber !== null && seasonNumber !== undefined && episodeNumber !== null && episodeNumber !== undefined) {
    return buildEpisodeProviderId(normalizedParentProviderId, seasonNumber, episodeNumber);
  }

  if (absoluteEpisodeNumber !== null && absoluteEpisodeNumber !== undefined) {
    return buildAbsoluteEpisodeProviderId(normalizedParentProviderId, absoluteEpisodeNumber);
  }

  throw new HttpError(400, 'Invalid episode id.');
}

function normalizeContentId(contentId: string): string {
  const normalized = contentId.trim();
  if (!UUID_RE.test(normalized)) {
    throw new HttpError(400, 'Invalid metadata id.');
  }
  return normalized.toLowerCase();
}

function toProviderRef(identity: MediaIdentity): ContentProviderRefInput {
  if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return toTitleRef({
      mediaType: identity.mediaType,
      provider: identity.provider ?? authorityProviderForEntityType(identity.mediaType),
      providerId: identity.providerId ?? identity.tmdbId ?? identity.mediaKey,
      metadata: identity.providerMetadata,
    });
  }

  if (identity.mediaType === 'season') {
    if (!identity.parentProviderId || identity.seasonNumber === null) {
      throw new HttpError(400, 'Unable to resolve canonical content id.');
    }

    return toSeasonRef({
      parentMediaType: resolveParentMediaType(identity),
      provider: identity.provider ?? authorityProviderForEntityType('season', resolveParentMediaType(identity)),
      parentProviderId: identity.parentProviderId,
      seasonNumber: identity.seasonNumber,
      metadata: identity.providerMetadata,
    });
  }

  if (!identity.parentProviderId) {
    throw new HttpError(400, 'Unable to resolve canonical content id.');
  }

  return toEpisodeRef({
    parentMediaType: resolveParentMediaType(identity),
    provider: identity.provider ?? authorityProviderForEntityType('episode', resolveParentMediaType(identity)),
    parentProviderId: identity.parentProviderId,
    seasonNumber: identity.seasonNumber,
    episodeNumber: identity.episodeNumber,
    absoluteEpisodeNumber: identity.absoluteEpisodeNumber,
    metadata: identity.providerMetadata,
  });
}

function toTitleRef(input: TitleIdentityInput): ContentProviderRefInput {
  const providerId = normalizeIdentifier(input.providerId, 'Invalid provider id.');
  const provider = input.provider ?? authorityProviderForEntityType(input.mediaType);
  return {
    provider,
    entityType: input.mediaType,
    externalId: providerId,
    metadata: {
      ...(input.metadata ?? {}),
      providerId,
    },
  };
}

function toEpisodeRef(input: EpisodeIdentityInput): ContentProviderRefInput {
  const provider = input.provider ?? authorityProviderForEntityType('episode', input.parentMediaType);
  const parentProviderId = normalizeIdentifier(input.parentProviderId, 'Invalid provider id.');
  const externalId = episodeRefMapKey(
    parentProviderId,
    input.seasonNumber ?? null,
    input.episodeNumber ?? null,
    input.absoluteEpisodeNumber ?? null,
  );

  return {
    provider,
    entityType: 'episode',
    externalId,
    metadata: {
      ...(input.metadata ?? {}),
      parentMediaType: input.parentMediaType,
      parentProviderId,
      seasonNumber: input.seasonNumber ?? null,
      episodeNumber: input.episodeNumber ?? null,
      absoluteEpisodeNumber: input.absoluteEpisodeNumber ?? null,
    },
  };
}

function toSeasonRef(input: SeasonIdentityInput): ContentProviderRefInput {
  const provider = input.provider ?? authorityProviderForEntityType('season', input.parentMediaType);
  const parentProviderId = normalizeIdentifier(input.parentProviderId, 'Invalid provider id.');
  return {
    provider,
    entityType: 'season',
    externalId: buildSeasonProviderId(parentProviderId, input.seasonNumber),
    metadata: {
      ...(input.metadata ?? {}),
      parentMediaType: input.parentMediaType,
      parentProviderId,
      seasonNumber: input.seasonNumber,
    },
  };
}

function toPersonRef(tmdbPersonId: number): ContentProviderRefInput {
  return {
    provider: 'tmdb',
    entityType: 'person',
    externalId: String(tmdbPersonId),
    metadata: { tmdbPersonId },
  };
}

function parsePositiveInteger(value: string, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, message);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, message);
  }
  return parsed;
}

function parseEpisodeExternalId(
  provider: SupportedProvider,
  externalId: string,
  metadata: Record<string, unknown>,
): { parentMediaType: ParentMediaType; parentProviderId: string; seasonNumber: number | null; episodeNumber: number | null; absoluteEpisodeNumber: number | null } {
  if (externalId.includes(':a')) {
    const [parentProviderId, absoluteMarker] = externalId.split(':');
    if (!parentProviderId || !absoluteMarker?.startsWith('a')) {
      throw new HttpError(400, 'Invalid metadata id.');
    }

    const absoluteEpisodeNumber = parsePositiveInteger(absoluteMarker.slice(1), 'Invalid metadata id.');
    return {
      parentMediaType: inferParentMediaType(provider, metadata),
      parentProviderId,
      seasonNumber: asNullableInteger(metadata.seasonNumber),
      episodeNumber: asNullableInteger(metadata.episodeNumber) ?? absoluteEpisodeNumber,
      absoluteEpisodeNumber,
    };
  }

  const parts = externalId.split(':');
  if (parts.length !== 3) {
    throw new HttpError(400, 'Invalid metadata id.');
  }

  const seasonPart = parts[1] ?? '';
  const episodePart = parts[2] ?? '';
  if (!seasonPart.startsWith('s') || !episodePart.startsWith('e')) {
    throw new HttpError(400, 'Invalid metadata id.');
  }

  return {
    parentMediaType: inferParentMediaType(provider, metadata),
    parentProviderId: parts[0] ?? '',
    seasonNumber: parseNonNegativeInteger(seasonPart.slice(1), 'Invalid metadata id.'),
    episodeNumber: parsePositiveInteger(episodePart.slice(1), 'Invalid metadata id.'),
    absoluteEpisodeNumber: asNullableInteger(metadata.absoluteEpisodeNumber),
  };
}

function parseSeasonExternalId(
  provider: SupportedProvider,
  externalId: string,
  metadata: Record<string, unknown>,
): { parentMediaType: ParentMediaType; parentProviderId: string; seasonNumber: number } {
  const parts = externalId.split(':');
  if (parts.length !== 2 || !parts[1]?.startsWith('s')) {
    throw new HttpError(400, 'Invalid season id.');
  }

  return {
    parentMediaType: inferParentMediaType(provider, metadata),
    parentProviderId: parts[0] ?? '',
    seasonNumber: parseNonNegativeInteger(parts[1].slice(1), 'Invalid season id.'),
  };
}

function assertContentId(record: ContentProviderRefRecord | undefined): string {
  if (!record?.contentId) {
    throw new HttpError(500, 'Unable to resolve canonical content id.');
  }
  return record.contentId;
}

function providerRefKey(provider: string, entityType: ContentEntityType, externalId: string): string {
  return `${provider}:${entityType}:${externalId}`;
}

function dedupeProviderRefs(refs: ContentProviderRefInput[]): ContentProviderRefInput[] {
  const deduped = new Map<string, ContentProviderRefInput>();
  for (const ref of refs) {
    const key = providerRefKey(ref.provider, ref.entityType, ref.externalId);
    if (!deduped.has(key)) {
      deduped.set(key, ref);
    }
  }

  return [...deduped.values()];
}

function canMaterializeIdentity(identity: MediaIdentity): boolean {
  if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return Boolean(identity.providerId);
  }

  if (identity.mediaType === 'season') {
    return Boolean(identity.parentProviderId && identity.seasonNumber !== null);
  }

  return Boolean(
    identity.parentProviderId
    && ((identity.seasonNumber !== null && identity.episodeNumber !== null) || identity.absoluteEpisodeNumber !== null),
  );
}

function normalizeIdentifier(value: string | number, message: string): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  throw new HttpError(400, message);
}

function resolveParentMediaType(identity: MediaIdentity): ParentMediaType {
  const parentMediaType = parentMediaTypeForIdentity(identity);
  if (parentMediaType !== 'show' && parentMediaType !== 'anime') {
    throw new HttpError(400, 'Unable to resolve canonical content id.');
  }
  return parentMediaType;
}

function inferParentMediaType(provider: SupportedProvider, metadata: Record<string, unknown>): ParentMediaType {
  if (metadata.parentMediaType === 'show' || metadata.parentMediaType === 'anime') {
    return metadata.parentMediaType;
  }

  return provider === 'kitsu' ? 'anime' : 'show';
}

function selectAuthorityRef(entityType: ContentEntityType, refs: ContentProviderRefRecord[]): ContentProviderRefRecord | null {
  const matchingRefs = refs.filter((record) => record.entityType === entityType);
  const firstRef = matchingRefs[0];
  if (!firstRef) {
    return null;
  }

  if (entityType === 'person') {
    return matchingRefs.find((record) => record.provider === 'tmdb') ?? null;
  }

  if (entityType === 'movie' || entityType === 'show' || entityType === 'anime') {
    const provider = authorityProviderForEntityType(entityType);
    return matchingRefs.find((record) => record.provider === provider) ?? null;
  }

  const parentMediaType = inferParentMediaType(firstRef.provider as SupportedProvider, firstRef.metadata);
  const provider = authorityProviderForEntityType(entityType, parentMediaType);
  return matchingRefs.find((record) => record.provider === provider) ?? null;
}

function asNullableInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}
