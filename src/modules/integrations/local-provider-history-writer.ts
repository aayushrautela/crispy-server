import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { canonicalTitleMediaKey, parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
import type { ProfileRecord } from '../profiles/profile-local.service.js';

type ProfileRef = Pick<ProfileRecord, 'id'>;
import type { ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderSessionRecord } from './provider-sessions.repo.js';
import type { AppUser } from '../users/user.types.js';

export type ImportedProviderHistoryEntry = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  watchedAt: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
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
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async replaceImportedInteractions(
    client: DbClient,
    params: {
      appUser: AppUser;
      job: ProviderImportJobRecord;
      profile: ProfileRef;
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

        const contentIds = await this.contentIdentityService.ensureContentIds(
          client,
          params.watchlistItems.map((item) => parseMediaKey(item.mediaKey)),
        );

        const values: unknown[] = [];
        const tuples: string[] = [];
        params.watchlistItems.forEach((item, index) => {
          const itemId = contentIds.get(item.mediaKey);
          if (!itemId) {
            warnings.push(`skipped watchlist item ${item.mediaKey}: unresolved content id`);
            return;
          }
          const base = index * 6;
          tuples.push(`($${base + 1}::uuid, $${base + 2}::uuid, 'watchlist', $${base + 3}::uuid, $${base + 4}, $${base + 5}::timestamptz, 'provider_import', $${base + 6})`);
          values.push(accountId, profileId, itemId, item.mediaType, item.addedAt, provider);
        });

        if (tuples.length) {
          await client.query(
            `INSERT INTO user_state.profile_list_items (account_id, profile_id, list_kind, item_id, media_type, added_at, source_kind, source_provider)
             VALUES ${tuples.join(', ')}
             ON CONFLICT (profile_id, list_kind, item_id) DO UPDATE SET
               added_at = EXCLUDED.added_at,
               source_kind = EXCLUDED.source_kind,
               source_provider = EXCLUDED.source_provider,
               updated_at = now()`,
            values,
          );
        }
        watchlistInserted = tuples.length;
      }

      if (params.ratings.length > 0) {
        await client.query(
          `DELETE FROM user_state.profile_ratings
           WHERE profile_id = $1::uuid AND source_provider = $2 AND source_kind = 'provider_import'`,
          [profileId, provider],
        );

        const contentIds = await this.contentIdentityService.ensureContentIds(
          client,
          params.ratings.map((rating) => parseMediaKey(rating.mediaKey)),
        );

        const values: unknown[] = [];
        const tuples: string[] = [];
        params.ratings.forEach((rating, index) => {
          const ratingItemId = contentIds.get(rating.mediaKey);
          if (!ratingItemId) {
            warnings.push(`skipped rating ${rating.mediaKey}: unresolved content id`);
            return;
          }
          const base = index * 7;
          tuples.push(`($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}, $${base + 5}, $${base + 6}::timestamptz, 'provider_import', $${base + 7})`);
          values.push(accountId, profileId, ratingItemId, rating.mediaType, rating.rating, rating.ratedAt, provider);
        });

        if (tuples.length) {
          await client.query(
            `INSERT INTO user_state.profile_ratings (account_id, profile_id, item_id, media_type, rating, rated_at, source_kind, source_provider)
             VALUES ${tuples.join(', ')}
             ON CONFLICT (profile_id, item_id) DO UPDATE SET
               rating = EXCLUDED.rating,
               rated_at = EXCLUDED.rated_at,
               source_kind = EXCLUDED.source_kind,
               source_provider = EXCLUDED.source_provider,
               updated_at = now()`,
            values,
          );
        }
        ratingsInserted = tuples.length;
      }

      if (params.playbackStates.length > 0) {
        await client.query(
          `DELETE FROM user_state.playback_progress
           WHERE profile_id = $1::uuid AND source_provider = $2 AND source_kind = 'provider_import'`,
          [profileId, provider],
        );

        const identities = params.playbackStates.flatMap((state) => [
          parseMediaKey(state.titleMediaKey),
          parseMediaKey(state.mediaKey),
        ]);
        const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

        const values: unknown[] = [];
        const tuples: string[] = [];
        params.playbackStates.forEach((state, index) => {
          const titleItemId = contentIds.get(state.titleMediaKey);
          const playableItemId = contentIds.get(state.mediaKey);
          if (!titleItemId || !playableItemId) {
            warnings.push(`skipped playback state ${state.mediaKey}: unresolved content id`);
            return;
          }
          const playableIdentity = parseMediaKey(state.mediaKey);
          const seasonNumber = playableIdentity.seasonNumber ?? null;
          const episodeNumber = playableIdentity.episodeNumber ?? null;
          const base = index * 12;
          tuples.push(
            `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::timestamptz, $${base + 9}, $${base + 10}, 'provider_import', $${base + 11}, $${base + 12}::uuid)`,
          );
          values.push(
            profileId, titleItemId, playableItemId, state.mediaType, state.positionSeconds, state.durationSeconds,
            state.progressBps, state.occurredAt, seasonNumber, episodeNumber, provider, accountId,
          );
        });

        if (tuples.length) {
          await client.query(
            `INSERT INTO user_state.playback_progress
               (profile_id, title_item_id, playable_item_id, media_type, position_seconds, duration_seconds, progress_bps,
                last_activity_at, season_number, episode_number, source_kind, source_provider, account_id)
             VALUES ${tuples.join(', ')}
             ON CONFLICT (profile_id, title_item_id, playable_item_id) DO UPDATE SET
               playable_item_id = EXCLUDED.playable_item_id,
               position_seconds = EXCLUDED.position_seconds,
               duration_seconds = EXCLUDED.duration_seconds,
               progress_bps = EXCLUDED.progress_bps,
               last_activity_at = EXCLUDED.last_activity_at,
               season_number = EXCLUDED.season_number,
               episode_number = EXCLUDED.episode_number,
               source_kind = EXCLUDED.source_kind,
               source_provider = EXCLUDED.source_provider,
               dismissed_at = CASE WHEN EXCLUDED.dismissed_at IS NOT NULL THEN EXCLUDED.dismissed_at ELSE NULL END,
               updated_at = now()`,
            values,
          );
        }
        playbackInserted = tuples.length;
      }

      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore rollback failure */ }
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

    const identities = params.historyEntries.flatMap((entry) => {
      const identity = parseMediaKey(entry.mediaKey);
      return [identity, parseMediaKey(canonicalTitleMediaKey(identity))];
    });
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    const values: unknown[] = [];
    const tuples: string[] = [];
    params.historyEntries.forEach((entry, index) => {
      const identity = parseMediaKey(entry.mediaKey);
      const contentId = contentIds.get(entry.mediaKey);
      const titleContentId = contentIds.get(canonicalTitleMediaKey(identity));
      if (!contentId || !titleContentId) {
        return;
      }
      const base = index * 9;
      tuples.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}::uuid, $${base + 5}, 'playback_completed', $${base + 6}::timestamptz, $${base + 7}, $${base + 8}, 'provider_import', $${base + 9})`,
      );
      values.push(
        accountId, profileId, contentId, titleContentId, identity.mediaType,
        entry.watchedAt, entry.seasonNumber ?? null, entry.episodeNumber ?? null, provider,
      );
    });

    if (tuples.length) {
      await client.query(
        `INSERT INTO user_state.watch_events
           (account_id, profile_id, item_id, title_item_id, media_type, event_type,
            occurred_at, season_number, episode_number, source_kind, source_provider)
         VALUES ${tuples.join(', ')}`,
        values,
      );
    }

    return tuples.length;
  }
}
