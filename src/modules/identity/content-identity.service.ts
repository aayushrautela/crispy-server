import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import {
  authorityProviderForEntityType,
  buildEpisodeProviderId,
  buildSeasonProviderId,
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  showTmdbIdForIdentity,
  type MediaIdentity,
  type SupportedProvider,
} from './media-key.js';
import {
  ContentIdentityRepository,
  type ContentEntityType,
  type ContentItemRecord,
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
      mediaIdentity: MediaIdentity;
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

    const recordByKey = new Map<string, ContentProviderRefRecord>();
    for (const record of records) {
      recordByKey.set(providerRefKey(record.provider, record.entityType, record.externalId), record);
    }

    const resolved = new Map<string, string>();
    for (const entry of requested) {
      const record = recordByKey.get(providerRefKey(entry.ref.provider, entry.ref.entityType, entry.ref.externalId));
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

  async resolveProviderRefsForItemIds(client: DbClient, itemIds: string[]): Promise<Map<string, ContentProviderRefRecord[]>> {
    const contentIds = itemIds.map(assertPublicItemId);
    const refs = await this.repository.listProviderRefsByContentIds(client, contentIds);
    const grouped = new Map<string, ContentProviderRefRecord[]>();
    for (const ref of refs) {
      const existing = grouped.get(ref.contentId);
      if (existing) {
        existing.push(ref);
      } else {
        grouped.set(ref.contentId, [ref]);
      }
    }
    return grouped;
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

  async resolveParentItemIdsForEpisodes(client: DbClient, itemIds: string[]): Promise<Map<string, EpisodeParentItemIds>> {
    const decoded = new Map<string, string>();
    for (const itemId of itemIds) {
      try {
        const contentId = assertPublicItemId(itemId);
        if (!decoded.has(contentId)) {
          decoded.set(contentId, itemId);
        }
      } catch {
        // skip unparseable item id
      }
    }

    const result = new Map<string, EpisodeParentItemIds>();
    for (const itemId of itemIds) {
      result.set(itemId, { seriesItemId: null, seasonItemId: null });
    }
    if (!decoded.size) {
      return result;
    }

    const relationships = await this.repository.listParentRelationshipsBatch(client, [...decoded.keys()], ['series', 'season']);
    const byChild = new Map<string, ContentRelationshipRecord[]>();
    for (const relationship of relationships) {
      const existing = byChild.get(relationship.childContentId);
      if (existing) {
        existing.push(relationship);
      } else {
        byChild.set(relationship.childContentId, [relationship]);
      }
    }

    for (const [contentId, itemId] of decoded) {
      const childRelationships = byChild.get(contentId) ?? [];
      result.set(itemId, {
        seriesItemId: encodeRelationshipParent(childRelationships, 'series'),
        seasonItemId: encodeRelationshipParent(childRelationships, 'season'),
      });
    }
    return result;
  }

  async resolveTitleItemIdForPlayableItemId(client: DbClient, itemId: string): Promise<{ publicTitleItemId: string; mediaType: string }> {
    const contentId = assertPublicItemId(itemId);
    const item = await this.repository.findContentItemById(client, contentId);
    if (!item) {
      throw new HttpError(404, 'Metadata not found.');
    }

    const entityType = toReferenceEntityType(item.entityType);
    if (entityType === 'movie' || entityType === 'show') {
      return { publicTitleItemId: encodePublicItemId(contentId), mediaType: item.entityType };
    }

    if (entityType !== 'episode') {
      throw new HttpError(400, 'Invalid playable item id.');
    }

    const relationship = await this.repository.findParentRelationship(client, contentId, 'series');
    if (!relationship) {
      throw new HttpError(404, 'Metadata not found.');
    }

    return { publicTitleItemId: encodePublicItemId(relationship.parentContentId), mediaType: item.entityType };
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

  /**
   * Resolves a playable item id to its canonical content id, independent of the
   * provider namespace the caller used. Movies and shows already carry a stable
   * id; episodes are normalized to the TMDB-authority episode id for
   * (seriesTmdbId, season, episode) so that a progress event reported under any
   * addon namespace lands on the same content id the metadata service uses.
   *
   * When an episode is identified only as a show id plus season/episode, the same
   * canonicalization is applied. Returns the input content id unchanged when it
   * cannot be resolved (e.g. off-graph item).
   */
  async canonicalizePlayableItemId(
    client: DbClient,
    publicItemId: string,
    opts?: { seasonNumber?: number | null; episodeNumber?: number | null },
  ): Promise<string> {
    const contentId = assertPublicItemId(publicItemId);
    const identity = await this.resolveMediaIdentity(client, contentId);

    if (identity.mediaType === 'episode') {
      return this.canonicalizeEpisode(client, publicItemId, identity);
    }
    if (identity.mediaType === 'show' && opts?.seasonNumber != null && opts?.episodeNumber != null) {
      return this.canonicalizeEpisodeFromSeries(client, publicItemId, opts.seasonNumber, opts.episodeNumber);
    }
    return contentId;
  }

  private async canonicalizeEpisode(client: DbClient, publicItemId: string, identity: MediaIdentity): Promise<string> {
    const contentId = assertPublicItemId(publicItemId);
    if (identity.seasonNumber == null || identity.episodeNumber == null) {
      return contentId;
    }
    const seriesTmdbId = await this.resolveSeriesTmdbId(client, publicItemId);
    if (seriesTmdbId == null) {
      return contentId;
    }
    return this.ensureContentId(client, inferMediaIdentity({
      mediaType: 'episode',
      provider: 'tmdb',
      parentProvider: 'tmdb',
      parentProviderId: String(seriesTmdbId),
      seasonNumber: identity.seasonNumber,
      episodeNumber: identity.episodeNumber,
      providerMetadata: { tmdbId: seriesTmdbId, showTmdbId: seriesTmdbId },
    }));
  }

  private async canonicalizeEpisodeFromSeries(
    client: DbClient,
    publicItemId: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<string> {
    const contentId = assertPublicItemId(publicItemId);
    const seriesTmdbId = await this.resolveSeriesTmdbId(client, publicItemId);
    if (seriesTmdbId == null) {
      return contentId;
    }
    return this.ensureContentId(client, inferMediaIdentity({
      mediaType: 'episode',
      provider: 'tmdb',
      parentProvider: 'tmdb',
      parentProviderId: String(seriesTmdbId),
      seasonNumber,
      episodeNumber,
      providerMetadata: { tmdbId: seriesTmdbId, showTmdbId: seriesTmdbId },
    }));
  }

  private async resolveSeriesTmdbId(client: DbClient, publicItemId: string): Promise<number | null> {
    const contentId = assertPublicItemId(publicItemId);
    const item = await this.repository.findContentItemById(client, contentId);
    if (!item) {
      return null;
    }
    const entityType = toReferenceEntityType(item.entityType);
    const seriesContentId = entityType === 'episode'
      ? (await this.resolveParentItemIdsForEpisode(client, publicItemId)).seriesItemId
      : contentId;
    if (!seriesContentId) {
      return null;
    }
    const seriesIdentity = await this.resolveMediaIdentity(client, assertPublicItemId(seriesContentId));
    return seriesIdentity.tmdbId ?? showTmdbIdForIdentity(seriesIdentity);
  }

  /**
   * Resolves any content id (movie, show, season, or episode) to its metadata
   * identity. Unlike {@link resolveMediaIdentity} this does not reject season or
   * person entities, so the metadata detail route can serve every media type.
   */
  async resolveMetadataItemIdentity(client: DbClient, publicItemId: string): Promise<MediaIdentity> {
    const reference = await this.resolveContentReference(client, assertPublicItemId(publicItemId));
    if (reference.entityType === 'person') {
      throw new HttpError(400, 'Item is not a metadata title.');
    }
    return reference.mediaIdentity;
  }

  /**
   * Resolves an item id to the identity of the title it belongs to: an episode or
   * season maps to its parent series, while a movie or show maps to itself. Used
   * by series-level endpoints (ratings, reviews, extras) so an episode id is
   * transparently served the parent series' data.
   */
  async resolveSeriesItemIdentity(client: DbClient, publicItemId: string): Promise<MediaIdentity> {
    const contentId = assertPublicItemId(publicItemId);
    const identity = await this.resolveMetadataItemIdentity(client, publicItemId);
    if (identity.mediaType !== 'episode' && identity.mediaType !== 'season') {
      return identity;
    }
    const relationship = await this.repository.findParentRelationship(client, contentId, 'series');
    if (!relationship) {
      return identity;
    }
    return this.resolveMetadataItemIdentity(client, encodePublicItemId(relationship.parentContentId));
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
    const entityType = toReferenceEntityType(item.entityType);
    const authorityRef = selectAuthorityRef(entityType, refs);
    const parentRelationship =
      authorityRef && toReferenceEntityType(authorityRef.entityType) === 'episode'
        ? await this.repository.findParentRelationship(client, normalized, 'series')
        : null;

    return this.buildContentReference(normalized, item, refs, parentRelationship);
  }

  /**
   * Resolve many content references in a fixed number of queries (content items, provider
   * refs, and episode parent relationships are each loaded once). Returns `null` for any
   * content id that cannot be resolved instead of throwing, so callers can skip bad rows.
   */
  async resolveContentReferencesBatched(
    client: DbClient,
    contentIds: string[],
  ): Promise<Map<string, CanonicalContentReference | null>> {
    const normalizedIds = contentIds.map(normalizeContentId);
    const items = await this.repository.findContentItemsByIds(client, normalizedIds);
    const itemById = new Map(items.map((item) => [item.contentId, item]));

    const refs = await this.repository.listProviderRefsByContentIds(client, normalizedIds);
    const refsByContentId = new Map<string, ContentProviderRefRecord[]>();
    for (const ref of refs) {
      const existing = refsByContentId.get(ref.contentId);
      if (existing) {
        existing.push(ref);
      } else {
        refsByContentId.set(ref.contentId, [ref]);
      }
    }

    const episodeIds = normalizedIds.filter((id) => {
      const item = itemById.get(id);
      const refsForId = refsByContentId.get(id) ?? [];
      const authorityRef = item ? selectAuthorityRef(toReferenceEntityType(item.entityType), refsForId) : null;
      return authorityRef !== null && toReferenceEntityType(authorityRef.entityType) === 'episode';
    });
    const parentRelationships = episodeIds.length
      ? await this.repository.findParentRelationshipsByChildIds(client, episodeIds, 'series')
      : [];
    const parentRelationshipByChildId = new Map(parentRelationships.map((relationship) => [relationship.childContentId, relationship]));

    const result = new Map<string, CanonicalContentReference | null>();
    for (const id of normalizedIds) {
      const item = itemById.get(id) ?? null;
      const refsForId = refsByContentId.get(id) ?? [];
      try {
        result.set(id, this.buildContentReference(id, item, refsForId, parentRelationshipByChildId.get(id) ?? null));
      } catch {
        result.set(id, null);
      }
    }
    return result;
  }

  async resolveMediaIdentitiesBatched(
    client: DbClient,
    contentIds: string[],
  ): Promise<Map<string, MediaIdentity | null>> {
    const references = await this.resolveContentReferencesBatched(client, contentIds);
    const identities = new Map<string, MediaIdentity | null>();
    for (const [contentId, reference] of references) {
      const identity = reference && 'mediaIdentity' in reference ? reference.mediaIdentity : null;
      identities.set(contentId, identity);
    }
    return identities;
  }

  private buildContentReference(
    contentId: string,
    item: ContentItemRecord | null,
    refs: ContentProviderRefRecord[],
    parentRelationship: ContentRelationshipRecord | null,
  ): CanonicalContentReference {
    if (!item || !refs.length) {
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
        contentId,
        itemId: encodePublicItemId(contentId),
        entityType: authorityEntityType,
        mediaIdentity: inferMediaIdentity({
          contentId,
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
      return {
        contentId,
        itemId: encodePublicItemId(contentId),
        entityType: 'episode',
        mediaIdentity: inferMediaIdentity({
          contentId,
          mediaType: 'episode',
          provider: authorityRef.provider as SupportedProvider,
          parentProvider: authorityRef.provider as SupportedProvider,
          parentProviderId: parsed.parentProviderId,
          parentContentId: parentRelationship?.parentContentId ?? null,
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
        contentId,
        itemId: encodePublicItemId(contentId),
        entityType: 'season',
        mediaIdentity: inferMediaIdentity({
          contentId,
          mediaType: 'season',
          provider: authorityRef.provider as SupportedProvider,
          parentProvider: authorityRef.provider as SupportedProvider,
          parentProviderId: parsed.parentProviderId,
          seasonNumber: parsed.seasonNumber,
          providerMetadata: authorityRef.metadata,
        }),
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
      contentId,
      itemId: encodePublicItemId(contentId),
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
