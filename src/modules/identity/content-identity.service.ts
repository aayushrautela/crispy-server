import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import {
  authorityProviderForEntityType,
  buildEpisodeProviderId,
  buildSeasonProviderId,
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  type MediaIdentity,
  type SupportedProvider,
} from './media-key.js';
import {
  ContentIdentityRepository,
  type ContentEntityType,
  type ContentProviderRefInput,
  type ContentProviderRefRecord,
  type ContentRelationshipRecord,
  type ContentRelationshipType,
} from './content-identity.repo.js';
import { assertPublicItemId, encodePublicItemId } from './public-item-id.js';

type TitleMediaType = 'movie' | 'show';
type ParentMediaType = 'show';

type ReferenceEntityType = TitleMediaType | 'episode' | 'season' | 'person';

export type CanonicalContentReference =
  | {
      contentId: string;
      itemId: string;
      entityType: TitleMediaType | 'episode';
      mediaIdentity: MediaIdentity;
      providerRefs: ContentProviderRefRecord[];
      authorityRef: ContentProviderRefRecord;
    }
  | {
      contentId: string;
      itemId: string;
      entityType: 'season';
      parentMediaType: ParentMediaType;
      provider: SupportedProvider;
      providerId: string;
      parentProviderId: string;
      seasonNumber: number;
      providerRefs: ContentProviderRefRecord[];
      authorityRef: ContentProviderRefRecord;
    }
  | {
      contentId: string;
      itemId: string;
      entityType: 'person';
      provider: SupportedProvider;
      providerId: string;
      providerRefs: ContentProviderRefRecord[];
      authorityRef: ContentProviderRefRecord;
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
  metadata?: Record<string, unknown>;
};

export type SeasonIdentityInput = {
  parentMediaType: ParentMediaType;
  provider?: SupportedProvider;
  parentProviderId: string | number;
  seasonNumber: number;
  metadata?: Record<string, unknown>;
};

export type PersonIdentityInput = {
  provider?: SupportedProvider;
  providerId: string | number;
  metadata?: Record<string, unknown>;
};

export type EpisodeParentItemIds = {
  seriesItemId: string | null;
  seasonItemId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ContentIdentityService {
  constructor(private readonly repository = new ContentIdentityRepository()) {}

  async ensureContentId(client: DbClient, identity: MediaIdentity): Promise<string> {
    if (identity.contentId && UUID_RE.test(identity.contentId.trim())) {
      return normalizeContentId(identity.contentId);
    }

    if (identity.mediaType === 'movie' || identity.mediaType === 'show') {
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

    if (!identity.parentProviderId || identity.seasonNumber === null || identity.episodeNumber === null) {
      throw new HttpError(400, 'Unable to resolve canonical content id.');
    }

    return this.ensureEpisodeContentId(client, {
      parentMediaType: resolveParentMediaType(identity),
      provider: identity.provider ?? authorityProviderForEntityType('episode', resolveParentMediaType(identity)),
      parentProviderId: identity.parentProviderId,
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
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
    const contentIds = await this.ensureEpisodeContentIds(client, [input]);
    const contentId = contentIds.get(episodeRefMapKey(
      input.parentProviderId,
      input.seasonNumber ?? null,
      input.episodeNumber ?? null,
    ));
    if (!contentId) {
      throw new HttpError(500, 'Unable to resolve canonical content id.');
    }
    return contentId;
  }

  async ensureEpisodeContentIds(client: DbClient, inputs: EpisodeIdentityInput[]): Promise<Map<string, string>> {
    const normalizedInputs = inputs.map((input) => ({
      ...input,
      provider: input.provider ?? authorityProviderForEntityType('episode', input.parentMediaType),
      parentProviderId: normalizeIdentifier(input.parentProviderId, 'Invalid provider id.'),
      seasonNumber: input.seasonNumber ?? null,
      episodeNumber: input.episodeNumber ?? null,
    }));
    const episodeRefs = normalizedInputs.map((input) => toEpisodeRef(input));
    const parentRefs = normalizedInputs.map((input) => toTitleRef({
      mediaType: input.parentMediaType,
      provider: input.provider,
      providerId: input.parentProviderId,
      metadata: { parentProviderId: input.parentProviderId },
    }));
    const seasonRefs = normalizedInputs.flatMap((input) => (
      input.seasonNumber !== null
        ? [toSeasonRef({
          parentMediaType: input.parentMediaType,
          provider: input.provider,
          parentProviderId: input.parentProviderId,
          seasonNumber: input.seasonNumber,
        })]
        : []
    ));

    const allRecords = await this.ensureProviderRefRecords(client, [...episodeRefs, ...parentRefs, ...seasonRefs]);
    const recordByKey = new Map(allRecords.map((record) => [
      providerRefKey(record.provider, record.entityType, record.externalId),
      record,
    ]));

    const relationships = normalizedInputs.flatMap((input) => {
      const episodeRef = toEpisodeRef(input);
      const parentRef = toTitleRef({
        mediaType: input.parentMediaType,
        provider: input.provider,
        providerId: input.parentProviderId,
        metadata: { parentProviderId: input.parentProviderId },
      });
      const episodeRecord = recordByKey.get(providerRefKey(episodeRef.provider, episodeRef.entityType, episodeRef.externalId));
      const parentRecord = recordByKey.get(providerRefKey(parentRef.provider, parentRef.entityType, parentRef.externalId));
      if (!episodeRecord || !parentRecord) {
        return [];
      }

      const baseRelationships = [{
        childContentId: episodeRecord.contentId,
        parentContentId: parentRecord.contentId,
        relationshipType: 'series' as const,
        metadata: {
          provider: input.provider,
          parentMediaType: input.parentMediaType,
          parentProviderId: input.parentProviderId,
        },
      }];

      if (input.seasonNumber === null) {
        return baseRelationships;
      }

      const seasonRef = toSeasonRef({
        parentMediaType: input.parentMediaType,
        provider: input.provider,
        parentProviderId: input.parentProviderId,
        seasonNumber: input.seasonNumber,
      });
      const seasonRecord = recordByKey.get(providerRefKey(seasonRef.provider, seasonRef.entityType, seasonRef.externalId));
      if (!seasonRecord) {
        return baseRelationships;
      }

      return [
        ...baseRelationships,
        {
          childContentId: episodeRecord.contentId,
          parentContentId: seasonRecord.contentId,
          relationshipType: 'season' as const,
          metadata: {
            provider: input.provider,
            parentMediaType: input.parentMediaType,
            parentProviderId: input.parentProviderId,
            seasonNumber: input.seasonNumber,
          },
        },
        {
          childContentId: seasonRecord.contentId,
          parentContentId: parentRecord.contentId,
          relationshipType: 'series' as const,
          metadata: {
            provider: input.provider,
            parentMediaType: input.parentMediaType,
            parentProviderId: input.parentProviderId,
            seasonNumber: input.seasonNumber,
          },
        },
      ];
    });

    await this.repository.upsertContentRelationships(client, relationships);

    return new Map(episodeRefs.flatMap((ref) => {
      const record = recordByKey.get(providerRefKey(ref.provider, ref.entityType, ref.externalId));
      return record ? [[record.externalId, record.contentId] as const] : [];
    }));
  }

  async ensureSeasonContentId(client: DbClient, input: SeasonIdentityInput): Promise<string> {
    const parentRef = toTitleRef({
      mediaType: input.parentMediaType,
      provider: input.provider ?? authorityProviderForEntityType('season', input.parentMediaType),
      providerId: input.parentProviderId,
      metadata: { parentProviderId: normalizeIdentifier(input.parentProviderId, 'Invalid provider id.') },
    });
    const seasonRef = toSeasonRef(input);
    const [parentRecord, seasonRecord] = await this.ensureProviderRefRecords(client, [parentRef, seasonRef]);
    const seasonContentId = assertContentId(seasonRecord);
    await this.repository.upsertContentRelationship(client, {
      childContentId: seasonContentId,
      parentContentId: assertContentId(parentRecord),
      relationshipType: 'series',
      metadata: {
        provider: seasonRef.provider,
        parentMediaType: input.parentMediaType,
        parentProviderId: normalizeIdentifier(input.parentProviderId, 'Invalid provider id.'),
        seasonNumber: input.seasonNumber,
      },
    });
    return seasonContentId;
  }

  async ensureSeasonContentIds(
    client: DbClient,
    input: Omit<SeasonIdentityInput, 'seasonNumber'>,
    seasonNumbers: number[],
  ): Promise<Map<number, string>> {
    const normalizedInput = {
      ...input,
      provider: input.provider ?? authorityProviderForEntityType('season', input.parentMediaType),
      parentProviderId: normalizeIdentifier(input.parentProviderId, 'Invalid provider id.'),
    };
    const parentRef = toTitleRef({
      mediaType: normalizedInput.parentMediaType,
      provider: normalizedInput.provider,
      providerId: normalizedInput.parentProviderId,
      metadata: { parentProviderId: normalizedInput.parentProviderId },
    });
    const seasonRefs = seasonNumbers.map((seasonNumber) => toSeasonRef({
      ...normalizedInput,
      seasonNumber,
    }));
    const records = await this.ensureProviderRefRecords(client, [parentRef, ...seasonRefs]);
    const recordByKey = new Map(records.map((record) => [providerRefKey(record.provider, record.entityType, record.externalId), record]));
    const parentRecord = recordByKey.get(providerRefKey(parentRef.provider, parentRef.entityType, parentRef.externalId));

    if (parentRecord) {
      await this.repository.upsertContentRelationships(client, seasonRefs.flatMap((seasonRef) => {
        const seasonRecord = recordByKey.get(providerRefKey(seasonRef.provider, seasonRef.entityType, seasonRef.externalId));
        if (!seasonRecord) {
          return [];
        }
        const { seasonNumber } = parseSeasonExternalId(seasonRef.externalId, seasonRef.metadata ?? {});
        return [{
          childContentId: seasonRecord.contentId,
          parentContentId: parentRecord.contentId,
          relationshipType: 'series' as const,
          metadata: {
            provider: seasonRef.provider,
            parentMediaType: normalizedInput.parentMediaType,
            parentProviderId: normalizedInput.parentProviderId,
            seasonNumber,
          },
        }];
      }));
    }

    return new Map(
      seasonRefs.flatMap((ref) => {
        const record = recordByKey.get(providerRefKey(ref.provider, ref.entityType, ref.externalId));
        if (!record) {
          return [];
        }
        const { seasonNumber } = parseSeasonExternalId(record.externalId, record.metadata);
        return [[seasonNumber, record.contentId] as const];
      }),
    );
  }

  async ensurePersonContentId(client: DbClient, input: PersonIdentityInput): Promise<string> {
    const [record] = await this.ensureProviderRefRecords(client, [toPersonRef(input)]);
    return assertContentId(record);
  }

  async resolveProviderRefsForItemId(client: DbClient, itemId: string): Promise<ContentProviderRefRecord[]> {
    const contentId = assertPublicItemId(itemId);
    const item = await this.repository.findContentItemById(client, contentId);
    if (!item) {
      throw new HttpError(404, 'Metadata not found.');
    }

    const refs = await this.repository.listProviderRefsByContentId(client, contentId);
    if (!refs.length) {
      throw new HttpError(404, 'Metadata not found.');
    }

    return refs;
  }

  async resolveParentItemIdsForEpisode(client: DbClient, itemId: string): Promise<EpisodeParentItemIds> {
    const contentId = assertPublicItemId(itemId);
    const item = await this.repository.findContentItemById(client, contentId);
    if (!item) {
      throw new HttpError(404, 'Metadata not found.');
    }
    if (toReferenceEntityType(item.entityType) !== 'episode') {
      throw new HttpError(400, 'Invalid episode id.');
    }

    const relationships = await this.repository.listParentRelationships(client, contentId, ['series', 'season']);
    return {
      seriesItemId: encodeRelationshipParent(relationships, 'series'),
      seasonItemId: encodeRelationshipParent(relationships, 'season'),
    };
  }

  async resolveTitleItemIdForPlayableItemId(client: DbClient, itemId: string): Promise<string> {
    const contentId = assertPublicItemId(itemId);
    const item = await this.repository.findContentItemById(client, contentId);
    if (!item) {
      throw new HttpError(404, 'Metadata not found.');
    }

    const entityType = toReferenceEntityType(item.entityType);
    if (entityType === 'movie' || entityType === 'show') {
      return encodePublicItemId(contentId);
    }

    if (entityType !== 'episode') {
      throw new HttpError(400, 'Invalid playable item id.');
    }

    const relationship = await this.repository.findParentRelationship(client, contentId, 'series');
    if (!relationship) {
      throw new HttpError(404, 'Metadata not found.');
    }

    return encodePublicItemId(relationship.parentContentId);
  }

  private async ensureProviderRefRecords(
    client: DbClient,
    refs: ContentProviderRefInput[],
  ): Promise<ContentProviderRefRecord[]> {
    const requested = dedupeProviderRefs(refs);
    if (!requested.length) {
      return [];
    }

    const records = await this.repository.ensureProviderRefs(client, requested);
    const resolved = new Map<string, ContentProviderRefRecord>();
    for (const record of records) {
      resolved.set(providerRefKey(record.provider, record.entityType, record.externalId), record);
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

  async resolvePersonProviderRef(client: DbClient, personId: string, preferredProvider: SupportedProvider = 'tmdb'): Promise<ContentProviderRefRecord> {
    const reference = await this.resolveContentReference(client, assertPublicItemId(personId));
    if (reference.entityType !== 'person') {
      throw new HttpError(400, 'Invalid person id.');
    }

    const preferred = reference.providerRefs.find((ref) => ref.provider === preferredProvider && toReferenceEntityType(ref.entityType) === 'person');
    const fallback = reference.providerRefs.find((ref) => toReferenceEntityType(ref.entityType) === 'person');
    const resolved = preferred ?? fallback;
    if (!resolved) {
      throw new HttpError(404, 'Person metadata not found.');
    }
    return resolved;
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

    const entityType = toReferenceEntityType(item.entityType);
    const authorityRef = selectAuthorityRef(entityType, refs);
    if (!authorityRef) {
      throw new HttpError(404, 'Metadata not found.');
    }
    const authorityEntityType = toReferenceEntityType(authorityRef.entityType);

    if (authorityEntityType === 'movie' || authorityEntityType === 'show') {
      return {
        contentId: normalized,
        itemId: encodePublicItemId(normalized),
        entityType: authorityEntityType,
        mediaIdentity: inferMediaIdentity({
          contentId: normalized,
          mediaType: authorityEntityType,
          provider: authorityRef.provider as SupportedProvider,
          providerId: authorityRef.externalId,
          providerMetadata: authorityRef.metadata,
        }),
        providerRefs: refs,
        authorityRef,
      };
    }

    if (authorityEntityType === 'episode') {
      const parsed = parseEpisodeExternalId(authorityRef.externalId, authorityRef.metadata);
      const seriesRelationship = await this.repository.findParentRelationship(client, normalized, 'series');
      return {
        contentId: normalized,
        itemId: encodePublicItemId(normalized),
        entityType: 'episode',
        mediaIdentity: inferMediaIdentity({
          contentId: normalized,
          mediaType: 'episode',
          provider: authorityRef.provider as SupportedProvider,
          parentProvider: authorityRef.provider as SupportedProvider,
          parentProviderId: parsed.parentProviderId,
          parentContentId: seriesRelationship?.parentContentId ?? null,
          seasonNumber: parsed.seasonNumber,
          episodeNumber: parsed.episodeNumber,
          providerMetadata: authorityRef.metadata,
        }),
        providerRefs: refs,
        authorityRef,
      };
    }

    if (authorityEntityType === 'season') {
      const parsed = parseSeasonExternalId(authorityRef.externalId, authorityRef.metadata);
      return {
        contentId: normalized,
        itemId: encodePublicItemId(normalized),
        entityType: 'season',
        parentMediaType: parsed.parentMediaType,
        provider: authorityRef.provider as SupportedProvider,
        providerId: authorityRef.externalId,
        parentProviderId: parsed.parentProviderId,
        seasonNumber: parsed.seasonNumber,
        providerRefs: refs,
        authorityRef,
      };
    }

    return {
      contentId: normalized,
      itemId: encodePublicItemId(normalized),
      entityType: 'person',
      provider: authorityRef.provider as SupportedProvider,
      providerId: authorityRef.externalId,
      providerRefs: refs,
      authorityRef,
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
    throw new HttpError(400, 'Absolute episode ids are no longer supported.');
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
  if (identity.mediaType === 'movie' || identity.mediaType === 'show') {
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

  if (!identity.parentProviderId || identity.seasonNumber === null || identity.episodeNumber === null) {
    throw new HttpError(400, 'Unable to resolve canonical content id.');
  }

  return toEpisodeRef({
    parentMediaType: resolveParentMediaType(identity),
    provider: identity.provider ?? authorityProviderForEntityType('episode', resolveParentMediaType(identity)),
    parentProviderId: identity.parentProviderId,
    seasonNumber: identity.seasonNumber,
    episodeNumber: identity.episodeNumber,
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
    metadata: removeNullishProperties({
      ...(input.metadata ?? {}),
      providerId,
      tmdbId: provider === 'tmdb' ? parseOptionalPositiveInteger(providerId) : undefined,
    }),
  };
}

function toEpisodeRef(input: EpisodeIdentityInput): ContentProviderRefInput {
  const provider = input.provider ?? authorityProviderForEntityType('episode', input.parentMediaType);
  const parentProviderId = normalizeIdentifier(input.parentProviderId, 'Invalid provider id.');
  const externalId = episodeRefMapKey(
    parentProviderId,
    input.seasonNumber ?? null,
    input.episodeNumber ?? null,
  );

  return {
    provider,
    entityType: 'episode',
    externalId,
    metadata: removeNullishProperties({
      ...(input.metadata ?? {}),
      parentMediaType: input.parentMediaType,
      parentProviderId,
      seasonNumber: input.seasonNumber ?? null,
      episodeNumber: input.episodeNumber ?? null,
      showTmdbId: provider === 'tmdb' ? parseOptionalPositiveInteger(parentProviderId) : undefined,
    }),
  };
}

function toSeasonRef(input: SeasonIdentityInput): ContentProviderRefInput {
  const provider = input.provider ?? authorityProviderForEntityType('season', input.parentMediaType);
  const parentProviderId = normalizeIdentifier(input.parentProviderId, 'Invalid provider id.');
  return {
    provider,
    entityType: 'season',
    externalId: buildSeasonProviderId(parentProviderId, input.seasonNumber),
    metadata: removeNullishProperties({
      ...(input.metadata ?? {}),
      parentMediaType: input.parentMediaType,
      parentProviderId,
      seasonNumber: input.seasonNumber,
      showTmdbId: provider === 'tmdb' ? parseOptionalPositiveInteger(parentProviderId) : undefined,
    }),
  };
}

function toPersonRef(input: PersonIdentityInput): ContentProviderRefInput {
  const providerId = normalizeIdentifier(input.providerId, 'Invalid person id.');
  const provider = input.provider ?? authorityProviderForEntityType('person');
  return {
    provider,
    entityType: 'person',
    externalId: providerId,
    metadata: removeNullishProperties({
      ...(input.metadata ?? {}),
      providerId,
      tmdbPersonId: provider === 'tmdb' ? parseOptionalPositiveInteger(providerId) : undefined,
    }),
  };
}

function parsePositiveInteger(value: string, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, message);
  }
  return parsed;
}

function parseOptionalPositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, message);
  }
  return parsed;
}

function parseEpisodeExternalId(
  externalId: string,
  metadata: Record<string, unknown>,
): { parentMediaType: ParentMediaType; parentProviderId: string; seasonNumber: number; episodeNumber: number } {
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
    parentMediaType: inferParentMediaType(metadata),
    parentProviderId: parts[0] ?? '',
    seasonNumber: parseNonNegativeInteger(seasonPart.slice(1), 'Invalid metadata id.'),
    episodeNumber: parsePositiveInteger(episodePart.slice(1), 'Invalid metadata id.'),
  };
}

function parseSeasonExternalId(
  externalId: string,
  metadata: Record<string, unknown>,
): { parentMediaType: ParentMediaType; parentProviderId: string; seasonNumber: number } {
  const parts = externalId.split(':');
  if (parts.length !== 2 || !parts[1]?.startsWith('s')) {
    throw new HttpError(400, 'Invalid season id.');
  }

  return {
    parentMediaType: inferParentMediaType(metadata),
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
  if (identity.mediaType === 'movie' || identity.mediaType === 'show') {
    return Boolean(identity.providerId);
  }

  if (identity.mediaType === 'season') {
    return Boolean(identity.parentProviderId && identity.seasonNumber !== null);
  }

  return Boolean(identity.parentProviderId && identity.seasonNumber !== null && identity.episodeNumber !== null);
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
  if (parentMediaType !== 'show') {
    throw new HttpError(400, 'Unable to resolve canonical content id.');
  }
  return parentMediaType;
}

function inferParentMediaType(metadata: Record<string, unknown>): ParentMediaType {
  if (metadata.parentMediaType === 'show') {
    return 'show';
  }

  return 'show';
}

function selectAuthorityRef(entityType: ReferenceEntityType, refs: ContentProviderRefRecord[]): ContentProviderRefRecord | null {
  const matchingRefs = refs.filter((record) => toReferenceEntityType(record.entityType) === entityType);
  if (!matchingRefs.length) {
    return null;
  }

  return [...matchingRefs].sort(compareProviderRefsByAuthority)[0] ?? null;
}

function compareProviderRefsByAuthority(left: ContentProviderRefRecord, right: ContentProviderRefRecord): number {
  return providerPriority(left.provider) - providerPriority(right.provider)
    || left.provider.localeCompare(right.provider)
    || left.entityType.localeCompare(right.entityType)
    || left.externalId.localeCompare(right.externalId);
}

function providerPriority(provider: string): number {
  if (provider === 'tmdb') {
    return 0;
  }
  if (provider === 'tvdb') {
    return 1;
  }
  if (provider === 'imdb') {
    return 2;
  }
  if (provider === 'kitsu') {
    return 3;
  }
  return 100;
}

function toReferenceEntityType(entityType: ContentEntityType): ReferenceEntityType {
  return entityType === 'anime' ? 'show' : entityType;
}

function encodeRelationshipParent(
  relationships: ContentRelationshipRecord[],
  relationshipType: ContentRelationshipType,
): string | null {
  const relationship = relationships.find((entry) => entry.relationshipType === relationshipType);
  return relationship ? encodePublicItemId(relationship.parentContentId) : null;
}

function removeNullishProperties(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
