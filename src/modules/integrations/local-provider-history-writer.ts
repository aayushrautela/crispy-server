import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { canonicalTitleMediaKey, parseMediaKey, type MediaIdentity } from '../identity/media-key.js';
import type { ProfileRecord } from '../profiles/profile-local.service.js';
import type { ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderSessionRecord } from './provider-sessions.repo.js';
import type { AppUser } from '../users/user.types.js';

type ProfileRef = Pick<ProfileRecord, 'id'>;

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

    /**
     * Runs a query and, on failure, logs the SQL text together with the bound
     * parameter values and count. This is the diagnostic surface used to
     * capture malformed parameter sets (e.g. "could not determine data type of
     * parameter $N") during provider imports.
     */
    private async runQuery(
      client: DbClient,
      sql: string,
      params?: unknown[],
    ): Promise<unknown> {
      try {
        return await client.query(sql, params);
      } catch (error) {
        logger.error(
          { err: error, sql, params, paramCount: params?.length ?? 0 },
          'local provider import query failed',
        );
        throw error;
      }
    }

  /**
   * Replaces all watch data for the profile with the imported set. This is the
   * Jellyfin-style "reimport clears everything" semantics: provider origin is no
   * longer tracked, so the imported set is authoritative for the profile.
   */
  async replaceImportedInteractions(
    client: DbClient,
    params: {
      appUser: AppUser;
      job: ProviderImportJobRecord;
      profile: ProfileRef;
      providerSession: ProviderSessionRecord;
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

    let historyInserted = 0;
    let watchlistInserted = 0;
    let ratingsInserted = 0;
    let playbackInserted = 0;

    try {
      await client.query('BEGIN');

      await this.runQuery(client, 'DELETE FROM user_state.watch_state WHERE profile_id = $1::uuid', [profileId]);

      if (params.historyEntries.length > 0) {
        historyInserted = await this.upsertHistory(client, accountId, profileId, params.historyEntries, warnings);
      }
      if (params.playbackStates.length > 0) {
        playbackInserted = await this.upsertPlayback(client, accountId, profileId, params.playbackStates, warnings);
      }
      if (params.ratings.length > 0) {
        ratingsInserted = await this.upsertRatings(client, accountId, profileId, params.ratings, warnings);
      }
      if (params.watchlistItems.length > 0) {
        watchlistInserted = await this.upsertWatchlist(client, accountId, profileId, params.watchlistItems, warnings);
      }

      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore rollback failure */ }
      logger.error({ error, profileId }, 'local provider import write failed');
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

  private async upsertHistory(
    client: DbClient,
    accountId: string,
    profileId: string,
    entries: ImportedProviderHistoryEntry[],
    warnings: string[],
  ): Promise<number> {
    const identities = entries.flatMap((entry) => {
      const identity = parseMediaKey(entry.mediaKey);
      return [identity, parseMediaKey(canonicalTitleMediaKey(identity))];
    });
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    const deduped = new Map<string, ImportedProviderHistoryEntry>();
    for (const entry of entries) {
      const contentId = contentIds.get(entry.mediaKey);
      const titleContentId = contentIds.get(canonicalTitleMediaKey(parseMediaKey(entry.mediaKey)));
      if (!contentId || !titleContentId) {
        warnings.push(`skipped history item ${entry.mediaKey}: unresolved content id`);
        continue;
      }
      const key = `${titleContentId}|${contentId}`;
      const existing = deduped.get(key);
      if (!existing || entry.watchedAt > existing.watchedAt) {
        deduped.set(key, entry);
      }
    }

    const values: unknown[] = [];
    const tuples: string[] = [];
    [...deduped.values()].forEach((entry, index) => {
      const contentId = contentIds.get(entry.mediaKey)!;
      const titleContentId = contentIds.get(canonicalTitleMediaKey(parseMediaKey(entry.mediaKey)))!;
      const base = index * 6;
      tuples.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}::uuid, $${base + 5}, true, 1, $${base + 6}::timestamptz, 0, NULL, now())`,
      );
      values.push(
        profileId, accountId, contentId, titleContentId,
        entry.mediaType, entry.watchedAt,
      );
    });

    if (tuples.length) {
      await this.runQuery(
        client,
        `INSERT INTO user_state.watch_state
           (profile_id, account_id, item_id, title_item_id, media_type,
            played, play_count, last_played_at, position_seconds, progress_bps, updated_at)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (profile_id, item_id) DO NOTHING`,
        values,
      );
    }
    return tuples.length;
  }

  private async upsertPlayback(
    client: DbClient,
    accountId: string,
    profileId: string,
    states: ImportedProviderPlaybackState[],
    warnings: string[],
  ): Promise<number> {
    const identities = states.flatMap((state) => [
      parseMediaKey(state.titleMediaKey),
      parseMediaKey(state.mediaKey),
    ]);
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    const deduped = new Map<string, ImportedProviderPlaybackState>();
    for (const state of states) {
      const titleItemId = contentIds.get(state.titleMediaKey);
      const playableItemId = contentIds.get(state.mediaKey);
      if (!titleItemId || !playableItemId) {
        warnings.push(`skipped playback state ${state.mediaKey}: unresolved content id`);
        continue;
      }
      deduped.set(`${titleItemId}|${playableItemId}`, state);
    }

    const values: unknown[] = [];
    const tuples: string[] = [];
    [...deduped.values()].forEach((state, index) => {
      const titleItemId = contentIds.get(state.titleMediaKey)!;
      const playableItemId = contentIds.get(state.mediaKey)!;
      const playableIdentity = parseMediaKey(state.mediaKey);
      const base = index * 12;
      tuples.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}::uuid, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}::timestamptz, $${base + 11}, $${base + 12}, now())`,
      );
      values.push(
        profileId, accountId, playableItemId, titleItemId,
        state.mediaType,
        state.completed, 1,
        state.positionSeconds, state.durationSeconds, state.occurredAt,
        playableIdentity.seasonNumber ?? null, playableIdentity.episodeNumber ?? null,
      );
    });

    if (tuples.length) {
      await this.runQuery(
        client,
        `INSERT INTO user_state.watch_state
           (profile_id, account_id, item_id, title_item_id, media_type,
            played, play_count, position_seconds, duration_seconds, last_played_at,
            season_number, episode_number, updated_at)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (profile_id, item_id) DO NOTHING`,
        values,
      );
    }
    return tuples.length;
  }

  private async upsertRatings(
    client: DbClient,
    accountId: string,
    profileId: string,
    ratings: ImportedProviderRating[],
    warnings: string[],
  ): Promise<number> {
    const contentIds = await this.contentIdentityService.ensureContentIds(
      client,
      ratings.map((rating) => parseMediaKey(rating.mediaKey)),
    );

    const deduped = new Map<string, ImportedProviderRating>();
    for (const rating of ratings) {
      const ratingItemId = contentIds.get(rating.mediaKey);
      if (!ratingItemId) {
        warnings.push(`skipped rating ${rating.mediaKey}: unresolved content id`);
        continue;
      }
      const existing = deduped.get(ratingItemId);
      if (!existing || rating.ratedAt > existing.ratedAt) {
        deduped.set(ratingItemId, rating);
      }
    }

    const values: unknown[] = [];
    const tuples: string[] = [];
    [...deduped.values()].forEach((rating, index) => {
      const ratingItemId = contentIds.get(rating.mediaKey)!;
      const base = index * 6;
      tuples.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}, $${base + 5}, $${base + 6}::timestamptz, now())`,
      );
      values.push(profileId, accountId, ratingItemId, rating.mediaType, rating.rating, rating.ratedAt);
    });

    if (tuples.length) {
      await this.runQuery(
        client,
        `INSERT INTO user_state.watch_state
           (profile_id, account_id, item_id, media_type, rating, last_played_at, updated_at)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (profile_id, item_id) DO UPDATE SET
           rating = EXCLUDED.rating, updated_at = now()`,
        values,
      );
    }
    return tuples.length;
  }

  private async upsertWatchlist(
    client: DbClient,
    accountId: string,
    profileId: string,
    items: ImportedProviderListItem[],
    warnings: string[],
  ): Promise<number> {
    const contentIds = await this.contentIdentityService.ensureContentIds(
      client,
      items.flatMap((item) => [parseMediaKey(item.mediaKey), parseMediaKey(canonicalTitleMediaKey(parseMediaKey(item.mediaKey)))]),
    );

    const resolved = items
      .map((item) => {
        const itemId = contentIds.get(item.mediaKey);
        const titleItemId = contentIds.get(canonicalTitleMediaKey(parseMediaKey(item.mediaKey)));
        if (!itemId || !titleItemId) {
          warnings.push(`skipped watchlist item ${item.mediaKey}: unresolved content id`);
          return null;
        }
        return { itemId, titleItemId, item };
      })
      .filter((row): row is { itemId: string; titleItemId: string; item: ImportedProviderListItem } => row !== null);

    const deduped = new Map<string, { itemId: string; titleItemId: string; item: ImportedProviderListItem }>();
    for (const row of resolved) {
      deduped.set(row.itemId, row);
    }

    const values: unknown[] = [];
    const tuples: string[] = [];
    [...deduped.values()].forEach((row, index) => {
      const base = index * 5;
      tuples.push(`($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::uuid, $${base + 4}::uuid, $${base + 5}, true, now())`);
      values.push(profileId, accountId, row.itemId, row.titleItemId, row.item.mediaType);
    });

    if (tuples.length) {
      await this.runQuery(
        client,
        `INSERT INTO user_state.watch_state
           (profile_id, account_id, item_id, title_item_id, media_type, is_favorite, updated_at)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (profile_id, item_id) DO UPDATE SET is_favorite = true, updated_at = now()`,
        values,
      );
    }
    return tuples.length;
  }
}
