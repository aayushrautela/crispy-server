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

export type SupabaseProviderHistorySyncResult = {
  inserted: number;
  skipped: boolean;
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
}
