import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { canonicalTitleMediaKey, canonicalTitleMediaType, parseMediaKey } from '../identity/media-key.js';
import type { ProfileRecord } from '../profiles/profile.repo.js';
import type { ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderSessionRecord } from './provider-sessions.repo.js';
import type { AppUser } from '../users/user.types.js';

export type ImportedProviderHistoryEntry = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  watchedAt: string;
};

export type ImportedProviderListItem = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  addedAt: string;
};

export type ImportedProviderRating = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  rating: number;
  ratedAt: string;
};

export type ImportedProviderPlaybackState = {
  mediaKey: string;
  titleMediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  positionSeconds: number;
  durationSeconds: number;
  progressBps: number;
  occurredAt: string;
  completed: boolean;
};

export type LocalProviderImportSyncResult = {
  historyInserted: number;
  watchlistInserted: number;
  ratingsInserted: number;
  playbackInserted: number;
  skipped: boolean;
  warnings: string[];
};

export class LocalProviderHistoryWriter {
  async replaceImportedInteractions(
    client: DbClient,
    params: {
      appUser: AppUser;
      job: ProviderImportJobRecord;
      profile: ProfileRecord;
      providerSession: ProviderSessionRecord;
      historyGeneration: number;
      importedAt: string;
      historyEntries: ImportedProviderHistoryEntry[];
      watchlistItems: ImportedProviderListItem[];
      ratings: ImportedProviderRating[];
      playbackStates: ImportedProviderPlaybackState[];
    },
  ): Promise<LocalProviderImportSyncResult> {
    const warnings: string[] = [];
    const accountId = params.appUser.authSubject;
    const profileId = params.profile.id;
    const provider = params.job.provider;

    let historyInserted = 0;
    let watchlistInserted = 0;
    let ratingsInserted = 0;
    let playbackInserted = 0;

    try {
      await client.query('BEGIN');

      if (params.historyEntries.length > 0) {
        const histResult = await this.replaceHistory(client, accountId, profileId, provider, params);
        historyInserted = histResult;
      }

      if (params.watchlistItems.length > 0) {
        await client.query(
          `DELETE FROM user_state.profile_list_items
           WHERE profile_id = $1::uuid AND source_provider = $2 AND source_kind = 'provider_import'`,
          [profileId, provider],
        );

        for (const item of params.watchlistItems) {
          await client.query(
            `INSERT INTO user_state.profile_list_items (account_id, profile_id, list_kind, media_key, media_type, added_at, source_kind, source_provider)
             VALUES ($1::uuid, $2::uuid, 'watchlist', $3, $4, $5::timestamptz, 'provider_import', $6)
             ON CONFLICT (profile_id, list_kind, media_key) DO UPDATE SET
               added_at = EXCLUDED.added_at,
               source_kind = EXCLUDED.source_kind,
               source_provider = EXCLUDED.source_provider,
               updated_at = now()`,
            [accountId, profileId, item.mediaKey, item.mediaType, item.addedAt, provider],
          );
        }
        watchlistInserted = params.watchlistItems.length;
      }

      if (params.ratings.length > 0) {
        await client.query(
          `DELETE FROM user_state.profile_ratings
           WHERE profile_id = $1::uuid AND source_provider = $2 AND source_kind = 'provider_import'`,
          [profileId, provider],
        );

        for (const r of params.ratings) {
          await client.query(
            `INSERT INTO user_state.profile_ratings (account_id, profile_id, media_key, media_type, rating, rated_at, source_kind, source_provider)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, 'provider_import', $7)
             ON CONFLICT (profile_id, media_key) DO UPDATE SET
               rating = EXCLUDED.rating,
               rated_at = EXCLUDED.rated_at,
               source_kind = EXCLUDED.source_kind,
               source_provider = EXCLUDED.source_provider,
               updated_at = now()`,
            [accountId, profileId, r.mediaKey, r.mediaType, r.rating, r.ratedAt, provider],
          );
        }
        ratingsInserted = params.ratings.length;
      }

      if (params.playbackStates.length > 0) {
        await client.query(
          `DELETE FROM user_state.playback_progress
           WHERE profile_id = $1::uuid AND source_provider = $2 AND source_kind = 'provider_import'`,
          [profileId, provider],
        );

        for (const s of params.playbackStates) {
          await client.query(
            `INSERT INTO user_state.playback_progress
               (profile_id, title_media_key, playable_media_key, media_type, position_seconds, duration_seconds, progress_bps,
                last_activity_at, source_kind, source_provider, account_id)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::timestamptz, 'provider_import', $9, $10::uuid)
             ON CONFLICT (profile_id, title_media_key) DO UPDATE SET
               playable_media_key = EXCLUDED.playable_media_key,
               position_seconds = EXCLUDED.position_seconds,
               duration_seconds = EXCLUDED.duration_seconds,
               progress_bps = EXCLUDED.progress_bps,
               last_activity_at = EXCLUDED.last_activity_at,
               source_kind = EXCLUDED.source_kind,
               source_provider = EXCLUDED.source_provider,
               dismissed_at = CASE WHEN EXCLUDED.dismissed_at IS NOT NULL THEN EXCLUDED.dismissed_at ELSE NULL END,
               updated_at = now()`,
            [profileId, s.titleMediaKey, s.mediaKey, s.mediaType, s.positionSeconds, s.durationSeconds, s.progressBps,
             s.occurredAt, provider, accountId],
          );
        }
        playbackInserted = params.playbackStates.length;
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, profileId, provider }, 'local provider import write failed');
      return {
        historyInserted: 0,
        watchlistInserted: 0,
        ratingsInserted: 0,
        playbackInserted: 0,
        skipped: true,
        warnings: [`local provider import write failed: ${error instanceof Error ? error.message : 'unknown error'}`],
      };
    }

    logger.info({
      profileId,
      provider,
      historyInserted,
      watchlistInserted,
      ratingsInserted,
      playbackInserted,
    }, 'local provider import synced');

    return {
      historyInserted,
      watchlistInserted,
      ratingsInserted,
      playbackInserted,
      skipped: false,
      warnings,
    };
  }

  private async replaceHistory(
    client: DbClient,
    accountId: string,
    profileId: string,
    provider: string,
    params: {
      historyEntries: ImportedProviderHistoryEntry[];
      importedAt: string;
    },
  ): Promise<number> {
    await client.query(
      `DELETE FROM user_state.watch_events
       WHERE profile_id = $1::uuid AND source_provider = $2 AND source_kind = 'provider_import'`,
      [profileId, provider],
    );

    let inserted = 0;
    for (const entry of params.historyEntries) {
      const identity = parseMediaKey(entry.mediaKey);
      await client.query(
        `INSERT INTO user_state.watch_events
           (account_id, profile_id, media_key, title_media_key, media_type, event_type,
            occurred_at, source_kind, source_provider)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'playback_completed', $6::timestamptz, 'provider_import', $7)`,
        [accountId, profileId, entry.mediaKey, canonicalTitleMediaKey(identity), canonicalTitleMediaType(identity), entry.watchedAt, provider],
      );
      inserted++;
    }

    return inserted;
  }
}
