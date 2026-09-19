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
  playCount?: number | null;
};

export type ImportedProviderListItem = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  addedAt: string;
};

export type ImportedProviderRating = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  liked: boolean;
  originRating: number | null;
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
    const profileId = params.profile.id;

    let historyInserted = 0;
    let watchlistInserted = 0;
    let ratingsInserted = 0;
    let playbackInserted = 0;

    try {
      await client.query('BEGIN');

      await this.runQuery(client, 'DELETE FROM user_state.watch_state WHERE profile_id = $1::uuid', [profileId]);

      if (params.historyEntries.length > 0 || params.playbackStates.length > 0) {
        const applied = await this.upsertWatchStates(
          client,
          profileId,
          params.historyEntries,
          params.playbackStates,
          warnings,
        );
        historyInserted = applied.historyInserted;
        playbackInserted = applied.playbackInserted;
      }
      if (params.ratings.length > 0) {
        ratingsInserted = await this.upsertRatings(client, profileId, params.ratings, warnings);
      }
      if (params.watchlistItems.length > 0) {
        watchlistInserted = await this.upsertWatchlist(client, profileId, params.watchlistItems, warnings);
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

  /**
   * Merges imported history and playback events into one play-state row per item,
   * keeping the watch_state invariant from migration 0069
   * (played = true ⟺ position_seconds = 0; in-progress ⟺ played = false).
   *
   * Both sources are event streams for the same physical state. Folding them into
   * independent SQL merges (e.g. played = old OR new alongside position = new) lets
   * the fields disagree and trips watch_state_played_position_check. Instead the
   * most recent event per item wins and the full (played, play_count, position)
   * triple is derived from that single event, mirroring
   * LocalUserWatchService.recordPlaybackState:
   *   - latest event is a completion (history entry or completed playback)
   *       → played = true,  position_seconds = 0
   *   - latest event is an in-progress snapshot (rewatch of a completed title)
   *       → played = false, position_seconds = N, play_count kept from earlier completions
   */
  private async upsertWatchStates(
    client: DbClient,
    profileId: string,
    historyEntries: ImportedProviderHistoryEntry[],
    playbackStates: ImportedProviderPlaybackState[],
    warnings: string[],
  ): Promise<{ historyInserted: number; playbackInserted: number }> {
    const identities = [
      ...historyEntries.map((entry) => parseMediaKey(entry.mediaKey)),
      ...playbackStates.flatMap((state) => [
        parseMediaKey(state.titleMediaKey),
        parseMediaKey(state.mediaKey),
      ]),
    ];
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);

    const historyByItem = new Map<string, ImportedProviderHistoryEntry>();
    const explicitPlayCountByItem = new Map<string, number>();
    const perEventCountByItem = new Map<string, number>();
    for (const entry of historyEntries) {
      const itemId = contentIds.get(entry.mediaKey);
      if (!itemId) {
        warnings.push(`skipped history item ${entry.mediaKey}: unresolved content id`);
        continue;
      }
      const existing = historyByItem.get(itemId);
      if (!existing || entry.watchedAt > existing.watchedAt) {
        historyByItem.set(itemId, entry);
      }
      // Providers supply an aggregate play count on the entries they emit from
      // `/sync/watch/*` (Trakt's `plays`). Entries from per-event history
      // endpoints carry no count, so the safest read is the larger of the
      // explicit aggregate and the number of distinct per-event rows: the
      // aggregate is authoritative, and per-event rows keep the count when the
      // aggregate truncates long histories. Keeping the two signals separate
      // avoids double counting the same viewings.
      if (entry.playCount && Number.isInteger(entry.playCount) && entry.playCount > 0) {
        explicitPlayCountByItem.set(itemId, Math.max(explicitPlayCountByItem.get(itemId) ?? 0, entry.playCount));
      } else {
        perEventCountByItem.set(itemId, (perEventCountByItem.get(itemId) ?? 0) + 1);
      }
    }

    const playbackByItem = new Map<string, ImportedProviderPlaybackState>();
    for (const state of playbackStates) {
      const itemId = contentIds.get(state.mediaKey);
      if (!itemId || !contentIds.get(state.titleMediaKey)) {
        warnings.push(`skipped playback state ${state.mediaKey}: unresolved content id`);
        continue;
      }
      const existing = playbackByItem.get(itemId);
      if (!existing || state.occurredAt > existing.occurredAt) {
        playbackByItem.set(itemId, state);
      }
    }

    const itemIds = new Set<string>([...historyByItem.keys(), ...playbackByItem.keys()]);
    const playCountForItem = (itemId: string): number => Math.max(
      1,
      explicitPlayCountByItem.get(itemId) ?? 0,
      perEventCountByItem.get(itemId) ?? 0,
    );
    const values: unknown[] = [];
    const tuples: string[] = [];
    [...itemIds].forEach((itemId, index) => {
      const history = historyByItem.get(itemId);
      const playback = playbackByItem.get(itemId);
      const playbackIsLatest = playback !== undefined
        && (history === undefined || playback.occurredAt > history.watchedAt);

      let played: boolean;
      let playCount: number;
      let lastPlayedAt: string;
      let positionSeconds: number;
      if (playbackIsLatest && !playback.completed) {
        played = false;
        playCount = history ? playCountForItem(itemId) : 0;
        lastPlayedAt = playback.occurredAt;
        positionSeconds = playback.positionSeconds;
      } else if (playbackIsLatest) {
        played = true;
        playCount = playCountForItem(itemId);
        lastPlayedAt = playback.occurredAt;
        positionSeconds = 0;
      } else {
        played = true;
        playCount = playCountForItem(itemId);
        lastPlayedAt = history!.watchedAt;
        positionSeconds = 0;
      }

      const base = index * 6;
      tuples.push(
        `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}, $${base + 4}, $${base + 5}::timestamptz, $${base + 6})`,
      );
      values.push(profileId, itemId, played, playCount, lastPlayedAt, positionSeconds);
    });

    if (tuples.length) {
      await this.runQuery(
        client,
        `INSERT INTO user_state.watch_state
            (profile_id, item_id, played, play_count, last_played_at, position_seconds)
          VALUES ${tuples.join(', ')}
          ON CONFLICT (profile_id, item_id) DO NOTHING`,
        values,
      );
    }
    return { historyInserted: historyByItem.size, playbackInserted: playbackByItem.size };
  }

  private async upsertRatings(
    client: DbClient,
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
      const base = index * 5;
      tuples.push(`($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::boolean, $${base + 4}::numeric, $${base + 5}::timestamptz)`);
      values.push(profileId, ratingItemId, rating.liked, rating.originRating, rating.ratedAt);
    });

    if (tuples.length) {
      await this.runQuery(
        client,
        `INSERT INTO user_state.watch_state
           (profile_id, item_id, liked, origin_rating, last_played_at)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (profile_id, item_id) DO UPDATE SET
           liked = EXCLUDED.liked, origin_rating = EXCLUDED.origin_rating, last_played_at = EXCLUDED.last_played_at`,
        values,
      );
    }
    return tuples.length;
  }

  private async upsertWatchlist(
    client: DbClient,
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
      const base = index * 2;
      tuples.push(`($${base + 1}::uuid, $${base + 2}::uuid, true)`);
      values.push(profileId, row.itemId);
    });

    if (tuples.length) {
      await this.runQuery(
        client,
        `INSERT INTO user_state.watch_state
           (profile_id, item_id, is_favorite)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (profile_id, item_id) DO UPDATE SET is_favorite = true`,
        values,
      );
    }
    return tuples.length;
  }
}
