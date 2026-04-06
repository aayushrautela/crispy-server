import type { DbClient } from '../src/lib/db.js';
import { db } from '../src/lib/db.js';
import { logger } from '../src/config/logger.js';
import { redis } from '../src/lib/redis.js';
import { homeCacheKey, calendarCacheKey } from '../src/modules/cache/cache-keys.js';
import { TvdbRemoteIdResolverService } from '../src/modules/metadata/providers/tvdb-remote-id-resolver.service.js';
import { TmdbCacheService } from '../src/modules/metadata/providers/tmdb-cache.service.js';
import { ProfileRepository } from '../src/modules/profiles/profile.repo.js';
import { WatchV2ProjectionRebuildService } from '../src/modules/watch-v2/watch-v2-projection-rebuild.service.js';

const PAGE_SIZE = 100;

type LegacyRef = {
  contentId: string;
  externalId: string;
  metadata: Record<string, unknown>;
};

type ContentIdMapping = {
  oldContentId: string;
  newContentId: string;
  reason: string;
};

type ResolvedShow = {
  tmdbShowId: number;
  tvdbShowId: string;
};

type ParsedSeasonRef = {
  tmdbShowId: number;
  seasonNumber: number;
};

type ParsedEpisodeRef = {
  tmdbShowId: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  externalId: string;
};

type ProviderRefLookup = {
  contentId: string;
  metadata: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function normalizeImdbId(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('tt')) {
    return trimmed;
  }
  return /^\d+$/.test(trimmed) ? `tt${trimmed}` : null;
}

function parseShowTmdbId(externalId: string): number {
  const parsed = Number(externalId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid TMDB show ref ${externalId}`);
  }
  return parsed;
}

function parseSeasonRef(externalId: string): ParsedSeasonRef {
  const match = externalId.match(/^(\d+):s(\d+)$/);
  if (!match) {
    throw new Error(`Invalid TMDB season ref ${externalId}`);
  }
  return {
    tmdbShowId: Number(match[1]),
    seasonNumber: Number(match[2]),
  };
}

function parseEpisodeRef(externalId: string): ParsedEpisodeRef {
  const standard = externalId.match(/^(\d+):s(\d+):e(\d+)$/);
  if (standard) {
    return {
      tmdbShowId: Number(standard[1]),
      seasonNumber: Number(standard[2]),
      episodeNumber: Number(standard[3]),
      absoluteEpisodeNumber: null,
      externalId,
    };
  }

  const absolute = externalId.match(/^(\d+):a(\d+)$/);
  if (absolute) {
    return {
      tmdbShowId: Number(absolute[1]),
      seasonNumber: null,
      episodeNumber: Number(absolute[2]),
      absoluteEpisodeNumber: Number(absolute[2]),
      externalId,
    };
  }

  throw new Error(`Invalid TMDB episode ref ${externalId}`);
}

async function listLegacyRefs(client: DbClient, entityType: 'show' | 'season' | 'episode'): Promise<LegacyRef[]> {
  const result = await client.query(
    `
      SELECT content_id::text AS content_id, external_id, metadata
      FROM content_provider_refs
      WHERE provider = 'tmdb'
        AND entity_type = $1
      ORDER BY external_id ASC
    `,
    [entityType],
  );

  return result.rows.map((row) => ({
    contentId: String(row.content_id),
    externalId: String(row.external_id),
    metadata: asRecord(row.metadata),
  }));
}

async function findProviderRef(
  client: DbClient,
  provider: 'tvdb' | 'tmdb',
  entityType: 'show' | 'season' | 'episode',
  externalId: string,
): Promise<ProviderRefLookup | null> {
  const result = await client.query(
    `
      SELECT content_id::text AS content_id, metadata
      FROM content_provider_refs
      WHERE provider = $1
        AND entity_type = $2
        AND external_id = $3
      LIMIT 1
    `,
    [provider, entityType, externalId],
  );

  const row = result.rows[0];
  return row
    ? { contentId: String(row.content_id), metadata: asRecord(row.metadata) }
    : null;
}

async function upsertProviderRef(
  client: DbClient,
  input: {
    contentId: string;
    provider: 'tvdb';
    entityType: 'show' | 'season' | 'episode';
    externalId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO content_provider_refs (content_id, provider, entity_type, external_id, metadata)
      VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
      ON CONFLICT (provider, entity_type, external_id)
      DO UPDATE SET
        content_id = EXCLUDED.content_id,
        metadata = content_provider_refs.metadata || EXCLUDED.metadata,
        updated_at = now()
    `,
    [input.contentId, input.provider, input.entityType, input.externalId, JSON.stringify(input.metadata)],
  );
}

function registerMapping(mappings: Map<string, ContentIdMapping>, oldContentId: string, newContentId: string, reason: string): void {
  if (oldContentId === newContentId) {
    return;
  }

  const existing = mappings.get(oldContentId);
  if (existing && existing.newContentId !== newContentId) {
    throw new Error(`Conflicting mapping for ${oldContentId}: ${existing.newContentId} vs ${newContentId}`);
  }

  mappings.set(oldContentId, { oldContentId, newContentId, reason });
}

async function resolveShow(client: DbClient, resolver: TvdbRemoteIdResolverService, tmdbCache: TmdbCacheService, tmdbShowId: number): Promise<ResolvedShow | null> {
  const title = await tmdbCache.getTitle(client, 'tv', tmdbShowId).catch(() => null);
  if (!title) {
    return null;
  }

  const externalIds = asRecord(title.externalIds);
  const tvdbShowId = asPositiveInteger(externalIds.tvdb_id);
  if (tvdbShowId !== null) {
    return { tmdbShowId, tvdbShowId: String(tvdbShowId) };
  }

  const imdbId = normalizeImdbId(asString(externalIds.imdb_id));
  if (!imdbId) {
    return null;
  }

  const resolvedTvdbId = await resolver.resolveSeriesId(imdbId);
  if (!resolvedTvdbId) {
    return null;
  }

  return { tmdbShowId, tvdbShowId: resolvedTvdbId };
}

async function deleteConflicts(client: DbClient, table: string, keyColumn: string, scopeColumns: string[], oldContentId: string, newContentId: string): Promise<void> {
  const scopes = scopeColumns.map((column) => `old_row.${column} = new_row.${column}`).join(' AND ');
  await client.query(
    `
      DELETE FROM ${table} old_row
      USING ${table} new_row
      WHERE old_row.${keyColumn} = $1::uuid
        AND new_row.${keyColumn} = $2::uuid
        AND ${scopes}
    `,
    [oldContentId, newContentId],
  );
}

async function updateReferenceColumn(client: DbClient, table: string, column: string, oldContentId: string, newContentId: string): Promise<void> {
  await client.query(
    `UPDATE ${table} SET ${column} = $2::uuid WHERE ${column} = $1::uuid`,
    [oldContentId, newContentId],
  );
}

async function applyContentIdMapping(client: DbClient, mapping: ContentIdMapping): Promise<void> {
  await deleteConflicts(client, 'profile_playable_state', 'content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'profile_watch_override', 'target_content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'profile_watchlist_state', 'target_content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'profile_rating_state', 'target_content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'profile_title_projection', 'title_content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'profile_tracked_title_state', 'title_content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'trakt_history_shadow', 'content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'trakt_watchlist_shadow', 'title_content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'trakt_rating_shadow', 'title_content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);
  await deleteConflicts(client, 'trakt_progress_shadow', 'content_id', ['profile_id'], mapping.oldContentId, mapping.newContentId);

  await updateReferenceColumn(client, 'profile_playable_state', 'content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_playable_state', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_watch_override', 'target_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_watchlist_state', 'target_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_rating_state', 'target_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_play_history', 'content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_play_history', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_title_projection', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_title_projection', 'active_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_tracked_title_state', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'profile_bulk_operations', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_outbox', 'content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_outbox', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'trakt_history_shadow', 'content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'trakt_watchlist_shadow', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'trakt_rating_shadow', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'trakt_progress_shadow', 'content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_history_shadow', 'content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_history_shadow', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_watchlist_shadow', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_rating_shadow', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_progress_shadow', 'content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_progress_shadow', 'title_content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_unresolved_objects', 'content_id', mapping.oldContentId, mapping.newContentId);
  await updateReferenceColumn(client, 'provider_unresolved_objects', 'title_content_id', mapping.oldContentId, mapping.newContentId);

  await client.query(
    `
      DELETE FROM content_provider_refs old_ref
      USING content_provider_refs new_ref
      WHERE old_ref.content_id = $1::uuid
        AND new_ref.content_id = $2::uuid
        AND old_ref.provider = new_ref.provider
        AND old_ref.entity_type = new_ref.entity_type
        AND old_ref.external_id = new_ref.external_id
    `,
    [mapping.oldContentId, mapping.newContentId],
  );
  await updateReferenceColumn(client, 'content_provider_refs', 'content_id', mapping.oldContentId, mapping.newContentId);
  await client.query(
    `
      DELETE FROM content_items ci
      WHERE ci.id = $1::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM content_provider_refs refs
          WHERE refs.content_id = ci.id
        )
    `,
    [mapping.oldContentId],
  );
}

async function purgeLegacyRefsAndCaches(client: DbClient): Promise<void> {
  await client.query(
    `
      DELETE FROM content_provider_refs
      WHERE provider = 'tmdb'
        AND entity_type IN ('show', 'season', 'episode')
    `,
  );

  await client.query(
    `
      DELETE FROM content_items ci
      WHERE ci.entity_type IN ('show', 'season', 'episode')
        AND NOT EXISTS (
          SELECT 1
          FROM content_provider_refs refs
          WHERE refs.content_id = ci.id
        )
    `,
  );

  await client.query(
    `
      DELETE FROM watch_media_card_cache
      WHERE media_key LIKE 'show:tmdb:%'
         OR media_key LIKE 'season:tmdb:%'
         OR media_key LIKE 'episode:tmdb:%'
    `,
  );
}

async function rebuildAllProfiles(): Promise<void> {
  const profileRepository = new ProfileRepository();
  const projectionRebuildService = new WatchV2ProjectionRebuildService();
  const client = await db.connect();

  let offset = 0;
  let rebuiltProfiles = 0;
  try {
    while (true) {
      const profiles = await profileRepository.listAll(client, PAGE_SIZE, offset);
      if (profiles.length === 0) {
        break;
      }

      for (const profile of profiles) {
        await client.query('BEGIN');
        try {
          const summary = await projectionRebuildService.rebuildProfile(client, profile.id);
          await client.query('COMMIT');
          rebuiltProfiles += 1;
          await redis.del(homeCacheKey(profile.id), calendarCacheKey(profile.id)).catch(() => undefined);
          logger.info({ profileId: profile.id, summary }, 'rebuilt watch projections after show cutover');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      offset += profiles.length;
    }

    logger.info({ rebuiltProfiles }, 'completed projection rebuild after show cutover');
  } finally {
    client.release();
  }
}

async function runCutover(client: DbClient): Promise<{ processedShows: number; contentMappings: number }> {
  const tmdbCache = new TmdbCacheService();
  const tvdbResolver = new TvdbRemoteIdResolverService();
  const showRefs = await listLegacyRefs(client, 'show');
  const seasonRefs = await listLegacyRefs(client, 'season');
  const episodeRefs = await listLegacyRefs(client, 'episode');
  const mappings = new Map<string, ContentIdMapping>();
  const resolvedShows = new Map<number, ResolvedShow>();
  const unresolved: string[] = [];

  for (const showRef of showRefs) {
    const tmdbShowId = parseShowTmdbId(showRef.externalId);
    const resolved = await resolveShow(client, tvdbResolver, tmdbCache, tmdbShowId);
    if (!resolved) {
      unresolved.push(`show:${tmdbShowId}`);
      continue;
    }

    resolvedShows.set(tmdbShowId, resolved);
    const existingTvdbShowRef = await findProviderRef(client, 'tvdb', 'show', resolved.tvdbShowId);
    const targetContentId = existingTvdbShowRef?.contentId ?? showRef.contentId;

    await upsertProviderRef(client, {
      contentId: targetContentId,
      provider: 'tvdb',
      entityType: 'show',
      externalId: resolved.tvdbShowId,
      metadata: {
        providerId: resolved.tvdbShowId,
        tmdbId: resolved.tmdbShowId,
        showTmdbId: resolved.tmdbShowId,
      },
    });

    registerMapping(mappings, showRef.contentId, targetContentId, `show ${tmdbShowId} -> ${resolved.tvdbShowId}`);
  }

  for (const seasonRef of seasonRefs) {
    const parsed = parseSeasonRef(seasonRef.externalId);
    const resolved = resolvedShows.get(parsed.tmdbShowId);
    if (!resolved) {
      unresolved.push(`season:${seasonRef.externalId}`);
      continue;
    }

    const newExternalId = `${resolved.tvdbShowId}:s${parsed.seasonNumber}`;
    const existingTvdbSeasonRef = await findProviderRef(client, 'tvdb', 'season', newExternalId);
    const targetContentId = existingTvdbSeasonRef?.contentId ?? seasonRef.contentId;

    await upsertProviderRef(client, {
      contentId: targetContentId,
      provider: 'tvdb',
      entityType: 'season',
      externalId: newExternalId,
      metadata: {
        ...seasonRef.metadata,
        providerId: newExternalId,
        parentMediaType: 'show',
        parentProviderId: resolved.tvdbShowId,
        seasonNumber: parsed.seasonNumber,
        tmdbId: resolved.tmdbShowId,
        showTmdbId: resolved.tmdbShowId,
      },
    });

    registerMapping(mappings, seasonRef.contentId, targetContentId, `season ${seasonRef.externalId} -> ${newExternalId}`);
  }

  for (const episodeRef of episodeRefs) {
    const parsed = parseEpisodeRef(episodeRef.externalId);
    const resolved = resolvedShows.get(parsed.tmdbShowId);
    if (!resolved) {
      unresolved.push(`episode:${episodeRef.externalId}`);
      continue;
    }

    const newExternalId = parsed.absoluteEpisodeNumber !== null && parsed.seasonNumber === null
      ? `${resolved.tvdbShowId}:a${parsed.absoluteEpisodeNumber}`
      : `${resolved.tvdbShowId}:s${parsed.seasonNumber}:e${parsed.episodeNumber}`;
    const existingTvdbEpisodeRef = await findProviderRef(client, 'tvdb', 'episode', newExternalId);
    const targetContentId = existingTvdbEpisodeRef?.contentId ?? episodeRef.contentId;

    await upsertProviderRef(client, {
      contentId: targetContentId,
      provider: 'tvdb',
      entityType: 'episode',
      externalId: newExternalId,
      metadata: {
        ...episodeRef.metadata,
        providerId: newExternalId,
        parentMediaType: 'show',
        parentProviderId: resolved.tvdbShowId,
        seasonNumber: parsed.seasonNumber,
        episodeNumber: parsed.episodeNumber,
        absoluteEpisodeNumber: parsed.absoluteEpisodeNumber,
        tmdbId: resolved.tmdbShowId,
        showTmdbId: resolved.tmdbShowId,
      },
    });

    registerMapping(mappings, episodeRef.contentId, targetContentId, `episode ${episodeRef.externalId} -> ${newExternalId}`);
  }

  if (unresolved.length > 0) {
    throw new Error(`Unable to resolve TVDB ids for: ${unresolved.join(', ')}`);
  }

  for (const mapping of mappings.values()) {
    await applyContentIdMapping(client, mapping);
  }

  await purgeLegacyRefsAndCaches(client);

  return {
    processedShows: resolvedShows.size,
    contentMappings: mappings.size,
  };
}

async function main(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const summary = await runCutover(client);
    await client.query('COMMIT');
    logger.info(summary, 'completed canonical TVDB show ref cutover');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await rebuildAllProfiles();
  await redis.quit().catch(() => undefined);
  await db.end();
}

void main();
