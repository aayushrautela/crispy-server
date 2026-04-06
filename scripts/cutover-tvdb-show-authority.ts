import { db } from '../src/lib/db.js';
import { logger } from '../src/config/logger.js';
import { redis } from '../src/lib/redis.js';
import { homeCacheKey, calendarCacheKey } from '../src/modules/cache/cache-keys.js';
import { ProfileRepository } from '../src/modules/profiles/profile.repo.js';
import { WatchV2ProjectionRebuildService } from '../src/modules/watch-v2/watch-v2-projection-rebuild.service.js';

const PAGE_SIZE = 100;

async function purgeLegacyShowData(): Promise<{
  deletedProjectionRows: number;
  deletedTrackedRows: number;
  deletedPlayableRows: number;
  deletedOverrideRows: number;
  deletedWatchlistRows: number;
  deletedRatingRows: number;
  deletedHistoryRows: number;
  deletedProviderRows: number;
  deletedShadowRows: number;
  deletedRefRows: number;
  deletedItemRows: number;
  deletedCacheRows: number;
}> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const legacyShowIds = await client.query<{ content_id: string }>(
      `
        SELECT DISTINCT content_id::text AS content_id
        FROM content_provider_refs
        WHERE provider = 'tmdb'
          AND entity_type = 'show'
      `,
    );

    const legacySeasonIds = await client.query<{ content_id: string }>(
      `
        SELECT DISTINCT content_id::text AS content_id
        FROM content_provider_refs
        WHERE provider = 'tmdb'
          AND entity_type = 'season'
      `,
    );

    const legacyEpisodeIds = await client.query<{ content_id: string }>(
      `
        SELECT DISTINCT content_id::text AS content_id
        FROM content_provider_refs
        WHERE provider = 'tmdb'
          AND entity_type = 'episode'
      `,
    );

    const allLegacyIds = [
      ...legacyShowIds.rows.map((row) => row.content_id),
      ...legacySeasonIds.rows.map((row) => row.content_id),
      ...legacyEpisodeIds.rows.map((row) => row.content_id),
    ];

    const deletedProjectionRows = await client.query(
      `
        DELETE FROM profile_title_projection
        WHERE title_content_id = ANY($1::uuid[])
           OR active_content_id = ANY($1::uuid[])
      `,
      [allLegacyIds],
    );

    const deletedTrackedRows = await client.query(
      `DELETE FROM profile_tracked_title_state WHERE title_content_id = ANY($1::uuid[])`,
      [legacyShowIds.rows.map((row) => row.content_id)],
    );

    const deletedPlayableRows = await client.query(
      `
        DELETE FROM profile_playable_state
        WHERE content_id = ANY($1::uuid[])
           OR title_content_id = ANY($1::uuid[])
      `,
      [allLegacyIds],
    );

    const deletedOverrideRows = await client.query(
      `DELETE FROM profile_watch_override WHERE target_content_id = ANY($1::uuid[])`,
      [legacyShowIds.rows.map((row) => row.content_id)],
    );

    const deletedWatchlistRows = await client.query(
      `DELETE FROM profile_watchlist_state WHERE target_content_id = ANY($1::uuid[])`,
      [legacyShowIds.rows.map((row) => row.content_id)],
    );

    const deletedRatingRows = await client.query(
      `DELETE FROM profile_rating_state WHERE target_content_id = ANY($1::uuid[])`,
      [legacyShowIds.rows.map((row) => row.content_id)],
    );

    const deletedHistoryRows = await client.query(
      `
        DELETE FROM profile_play_history
        WHERE content_id = ANY($1::uuid[])
           OR title_content_id = ANY($1::uuid[])
      `,
      [allLegacyIds],
    );

    const deletedProviderRows = await client.query(
      `
        DELETE FROM provider_outbox
        WHERE content_id = ANY($1::uuid[])
           OR title_content_id = ANY($1::uuid[])
      `,
      [allLegacyIds],
    );

    const deletedProviderHistory = await client.query(
      `
        DELETE FROM provider_history_shadow
        WHERE content_id = ANY($1::uuid[])
           OR title_content_id = ANY($1::uuid[])
      `,
      [allLegacyIds],
    );
    const deletedProviderWatchlist = await client.query(
      `DELETE FROM provider_watchlist_shadow WHERE title_content_id = ANY($1::uuid[])`,
      [legacyShowIds.rows.map((row) => row.content_id)],
    );
    const deletedProviderRating = await client.query(
      `DELETE FROM provider_rating_shadow WHERE title_content_id = ANY($1::uuid[])`,
      [legacyShowIds.rows.map((row) => row.content_id)],
    );
    const deletedProviderProgress = await client.query(
      `
        DELETE FROM provider_progress_shadow
        WHERE content_id = ANY($1::uuid[])
           OR title_content_id = ANY($1::uuid[])
      `,
      [allLegacyIds],
    );
    const deletedProviderUnresolved = await client.query(
      `
        DELETE FROM provider_unresolved_objects
        WHERE content_id = ANY($1::uuid[])
           OR title_content_id = ANY($1::uuid[])
      `,
      [allLegacyIds],
    );

    const deletedTraktHistory = await client.query(
      `DELETE FROM trakt_history_shadow WHERE content_id = ANY($1::uuid[])`,
      [allLegacyIds],
    );
    const deletedTraktWatchlist = await client.query(
      `DELETE FROM trakt_watchlist_shadow WHERE title_content_id = ANY($1::uuid[])`,
      [legacyShowIds.rows.map((row) => row.content_id)],
    );
    const deletedTraktRating = await client.query(
      `DELETE FROM trakt_rating_shadow WHERE title_content_id = ANY($1::uuid[])`,
      [legacyShowIds.rows.map((row) => row.content_id)],
    );
    const deletedTraktProgress = await client.query(
      `DELETE FROM trakt_progress_shadow WHERE content_id = ANY($1::uuid[])`,
      [allLegacyIds],
    );

    const deletedRefRows = await client.query(
      `
        DELETE FROM content_provider_refs
        WHERE provider = 'tmdb'
          AND entity_type IN ('show', 'season', 'episode')
      `,
    );

    const deletedItemRows = await client.query(
      `
        DELETE FROM content_items ci
        WHERE ci.id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1
            FROM content_provider_refs refs
            WHERE refs.content_id = ci.id
          )
      `,
      [allLegacyIds],
    );

    const deletedCacheRows = await client.query(
      `
        DELETE FROM watch_media_card_cache
        WHERE media_key LIKE 'show:tmdb:%'
           OR media_key LIKE 'season:tmdb:%'
           OR media_key LIKE 'episode:tmdb:%'
      `,
    );

    await client.query('COMMIT');

    return {
      deletedProjectionRows: deletedProjectionRows.rowCount ?? 0,
      deletedTrackedRows: deletedTrackedRows.rowCount ?? 0,
      deletedPlayableRows: deletedPlayableRows.rowCount ?? 0,
      deletedOverrideRows: deletedOverrideRows.rowCount ?? 0,
      deletedWatchlistRows: deletedWatchlistRows.rowCount ?? 0,
      deletedRatingRows: deletedRatingRows.rowCount ?? 0,
      deletedHistoryRows: deletedHistoryRows.rowCount ?? 0,
      deletedProviderRows: (deletedProviderRows.rowCount ?? 0)
        + (deletedProviderHistory.rowCount ?? 0)
        + (deletedProviderWatchlist.rowCount ?? 0)
        + (deletedProviderRating.rowCount ?? 0)
        + (deletedProviderProgress.rowCount ?? 0)
        + (deletedProviderUnresolved.rowCount ?? 0),
      deletedShadowRows: (deletedTraktHistory.rowCount ?? 0)
        + (deletedTraktWatchlist.rowCount ?? 0)
        + (deletedTraktRating.rowCount ?? 0)
        + (deletedTraktProgress.rowCount ?? 0),
      deletedRefRows: deletedRefRows.rowCount ?? 0,
      deletedItemRows: deletedItemRows.rowCount ?? 0,
      deletedCacheRows: deletedCacheRows.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
          logger.info({ profileId: profile.id, summary }, 'rebuilt watch projections after TMDB show purge');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      offset += profiles.length;
    }

    logger.info({ rebuiltProfiles }, 'completed projection rebuild after TMDB show purge');
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const summary = await purgeLegacyShowData();
  logger.info(summary, 'purged legacy TMDB show data and caches');
  await rebuildAllProfiles();
  await redis.quit().catch(() => undefined);
  await db.end();
}

void main();
