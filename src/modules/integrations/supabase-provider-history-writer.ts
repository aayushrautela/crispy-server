import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../config/logger.js';
import type { ProfileRecord } from '../profiles/profile.repo.js';
import type { ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderSessionRecord } from './provider-sessions.repo.js';
import type { AppUser } from '../users/user.types.js';

type ImportedHistoryEntryDraft = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  watchedAt: string;
  sourceKind: 'provider_import';
};

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

export type SupabaseProviderHistorySyncResult = {
  inserted: number;
  skipped: boolean;
};

export type SupabaseProviderImportSyncResult = {
  historyInserted: number;
  watchlistInserted: number;
  ratingsInserted: number;
  playbackInserted: number;
  skipped: boolean;
  warnings: string[];
};

export class SupabaseProviderHistoryWriter {
  constructor(private readonly supabaseClient: SupabaseClient | null) {}

  async replaceImportedHistory(params: {
    appUser: AppUser;
    job: ProviderImportJobRecord;
    profile: ProfileRecord;
    providerSession: ProviderSessionRecord;
    historyGeneration: number;
    importedAt: string;
    entries: ImportedHistoryEntryDraft[];
  }): Promise<SupabaseProviderHistorySyncResult> {
    if (!this.supabaseClient) {
      logger.warn({ profileId: params.profile.id, provider: params.job.provider }, 'supabase provider history sync skipped: no service role client configured');
      return { inserted: 0, skipped: true };
    }

    const appUser = params.appUser;

    const accountId = appUser.authSubject;
    const profileId = params.profile.id;
    const profileGroupId = params.profile.profileGroupId;

    const entriesJson = params.entries.map((entry) => ({
      media_key: entry.mediaKey,
      media_type: entry.mediaType,
      watched_at: entry.watchedAt,
      source_kind: entry.sourceKind,
    }));

    try {
      const { data, error } = await this.supabaseClient.rpc('replace_provider_import_history', {
        target_account_id: accountId,
        target_legacy_app_user_id: appUser.id,
        target_account_email: appUser.email ?? '',
        target_profile_id: profileId,
        target_legacy_profile_group_id: profileGroupId,
        target_profile_name: params.profile.name,
        target_avatar_key: params.profile.avatarKey,
        target_is_kids: params.profile.isKids,
        target_sort_order: params.profile.sortOrder,
        target_provider: params.job.provider,
        target_provider_user_id: params.providerSession.providerUserId ?? '',
        target_provider_username: params.providerSession.externalUsername ?? '',
        target_import_job_id: params.job.id,
        target_history_generation: params.historyGeneration,
        target_imported_at: params.importedAt,
        entries: entriesJson,
      });

      if (error) {
        logger.error({ error, profileId, provider: params.job.provider }, 'supabase provider history sync failed');
        return { inserted: 0, skipped: true };
      }

      const inserted = typeof data === 'number' ? data : Number(data) || 0;
      logger.info({ profileId, provider: params.job.provider, inserted }, 'supabase provider history synced');
      return { inserted, skipped: false };
    } catch (error) {
      logger.error({ error, profileId, provider: params.job.provider }, 'supabase provider history sync exception');
      return { inserted: 0, skipped: true };
    }
  }

  async replaceImportedInteractions(params: {
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
  }): Promise<SupabaseProviderImportSyncResult> {
    if (!this.supabaseClient) {
      logger.warn({ profileId: params.profile.id, provider: params.job.provider }, 'supabase provider import sync skipped: no service role client configured');
      return {
        historyInserted: 0,
        watchlistInserted: 0,
        ratingsInserted: 0,
        playbackInserted: 0,
        skipped: true,
        warnings: ['No Supabase service role client configured'],
      };
    }

    const warnings: string[] = [];
    const accountId = params.appUser.authSubject;
    const profileId = params.profile.id;
    const provider = params.job.provider;

    const historyResult = await this.callNumberRpc(
      'replace_provider_import_history',
      {
        target_account_id: accountId,
        target_legacy_app_user_id: params.appUser.id,
        target_account_email: params.appUser.email ?? '',
        target_profile_id: profileId,
        target_legacy_profile_group_id: params.profile.profileGroupId,
        target_profile_name: params.profile.name,
        target_avatar_key: params.profile.avatarKey,
        target_is_kids: params.profile.isKids,
        target_sort_order: params.profile.sortOrder,
        target_provider: provider,
        target_provider_user_id: params.providerSession.providerUserId ?? '',
        target_provider_username: params.providerSession.externalUsername ?? '',
        target_import_job_id: params.job.id,
        target_history_generation: params.historyGeneration,
        target_imported_at: params.importedAt,
        entries: params.historyEntries.map((e) => ({
          media_key: e.mediaKey,
          media_type: e.mediaType,
          watched_at: e.watchedAt,
          source_kind: 'provider_import',
        })),
      },
      { profileId, provider, context: 'history' },
    );
    if (historyResult.warning) warnings.push(historyResult.warning);

    const watchlistResult = await this.callNumberRpc(
      'replace_provider_import_list_items',
      {
        p_account_id: accountId,
        p_profile_id: profileId,
        p_provider: provider,
        p_list_kind: 'watchlist',
        p_items: params.watchlistItems.map((item) => ({
          media_key: item.mediaKey,
          media_type: item.mediaType,
          added_at: item.addedAt,
        })),
      },
      { profileId, provider, context: 'watchlist' },
    );
    if (watchlistResult.warning) warnings.push(watchlistResult.warning);

    const ratingsResult = await this.callNumberRpc(
      'replace_provider_import_ratings',
      {
        p_account_id: accountId,
        p_profile_id: profileId,
        p_provider: provider,
        p_ratings: params.ratings.map((r) => ({
          media_key: r.mediaKey,
          media_type: r.mediaType,
          rating: r.rating,
          rated_at: r.ratedAt,
        })),
      },
      { profileId, provider, context: 'ratings' },
    );
    if (ratingsResult.warning) warnings.push(ratingsResult.warning);

    const playbackResult = await this.callNumberRpc(
      'replace_provider_import_playback_states',
      {
        p_account_id: accountId,
        p_profile_id: profileId,
        p_provider: provider,
        p_states: params.playbackStates.map((s) => ({
          media_key: s.mediaKey,
          title_media_key: s.titleMediaKey,
          media_type: s.mediaType,
          position_seconds: s.positionSeconds,
          duration_seconds: s.durationSeconds,
          progress_bps: s.progressBps,
          occurred_at: s.occurredAt,
          completed: s.completed,
        })),
      },
      { profileId, provider, context: 'playback' },
    );
    if (playbackResult.warning) warnings.push(playbackResult.warning);

    logger.info({
      profileId,
      provider,
      historyInserted: historyResult.inserted,
      watchlistInserted: watchlistResult.inserted,
      ratingsInserted: ratingsResult.inserted,
      playbackInserted: playbackResult.inserted,
      warnings,
    }, 'supabase provider import synced');

    return {
      historyInserted: historyResult.inserted,
      watchlistInserted: watchlistResult.inserted,
      ratingsInserted: ratingsResult.inserted,
      playbackInserted: playbackResult.inserted,
      skipped: false,
      warnings,
    };
  }

  private async callNumberRpc(
    rpcName: string,
    args: Record<string, unknown>,
    context: { profileId: string; provider: string; context: string },
  ): Promise<{ inserted: number; warning?: string }> {
    try {
      const { data, error } = await this.supabaseClient!.rpc(rpcName, args);

      if (error) {
        logger.error({ error, ...context, rpcName }, 'supabase provider import rpc failed');
        return { inserted: 0, warning: `${context.context} sync failed: ${error.message}` };
      }

      const inserted = typeof data === 'number' ? data : Number(data) || 0;
      return { inserted };
    } catch (error) {
      logger.error({ error, ...context, rpcName }, 'supabase provider import rpc exception');
      return {
        inserted: 0,
        warning: `${context.context} sync exception: ${error instanceof Error ? error.message : 'unknown'}`,
      };
    }
  }
}
