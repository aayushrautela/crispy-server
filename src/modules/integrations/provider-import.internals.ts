import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import type { ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderSessionRecord } from './provider-sessions.repo.js';
import type { ImportedProviderHistoryEntry, ImportedProviderListItem, ImportedProviderPlaybackState, ImportedProviderRating } from './local-provider-history-writer.js';

export type ResolvedImportIdentity = {
  identity: MediaIdentity;
  mediaType: 'movie' | 'show';
  tmdbId: number | null;
  tvdbId: number | null;
  kitsuId: string | null;
};

export type ImportIdentityLookup = {
  mediaFamily: 'movie' | 'show' | 'anime';
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: string | null;
  kitsuId?: number | string | null;
};

export type ImportIdentityResolver = (
  cache: Map<string, ResolvedImportIdentity | null>,
  params: ImportIdentityLookup,
) => Promise<ResolvedImportIdentity | null>;

export type ImportedHistoryEntryDraft = {
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  provider?: string | null;
  providerId?: string | null;
  parentProvider?: string | null;
  parentProviderId?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | string | null;
  kitsuId?: number | string | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
  watchedAt: string;
  sourceKind: 'provider_import';
  payload?: Record<string, unknown>;
};

export type ImportedWatchEventDraft = {
  eventType: 'mark_watched' | 'playback_progress_snapshot' | 'playback_completed' | 'watchlist_put' | 'watchlist_remove' | 'rating_put' | 'rating_remove';
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  provider?: string | null;
  providerId?: string | null;
  parentProvider?: string | null;
  parentProviderId?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | string | null;
  kitsuId?: number | string | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
  rating?: number | null;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  progressBps?: number | null;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

export type ProviderReplaceImportPayload = {
  importedEvents: ImportedWatchEventDraft[];
  importedHistoryEntries: ImportedHistoryEntryDraft[];
  importedAt: string;
  importSummary: Record<string, unknown>;
  mediaKeysToRefresh?: string[];
};

export type ImportAccumulator = {
  importedEvents: ImportedWatchEventDraft[];
  importedHistoryEntries: ImportedHistoryEntryDraft[];
  mediaKeysToRefresh: Set<string>;
};

export function createImportAccumulator(): ImportAccumulator {
  return {
    importedEvents: [],
    importedHistoryEntries: [],
    mediaKeysToRefresh: new Set<string>(),
  };
}

export type ProviderImportFacts = {
  historyEntries: ImportedProviderHistoryEntry[];
  watchlistItems: ImportedProviderListItem[];
  ratings: ImportedProviderRating[];
  playbackStates: ImportedProviderPlaybackState[];
};

export type ProviderTokenExchangeResult = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  raw: Record<string, unknown>;
};

export type ProviderProfileResult = {
  providerUserId: string | null;
  externalUsername: string | null;
};

/**
 * Contract every provider-specific import module implements.
 * Each provider owns: OAuth (URL + exchange + revoke + profile),
 * HTTP fetch, response normalization into the shared payload shape,
 * and identity resolution against TMDB.
 */
export interface ProviderImportModule {
  readonly provider: import('./provider-import.types.js').ProviderImportProvider;

  isConfigured(): boolean;

  buildAuthUrl(stateToken: string, codeChallenge: string): string | null;

  exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<ProviderTokenExchangeResult>;

  fetchProfile(accessToken: string): Promise<ProviderProfileResult>;

  revokeAuthorization(credentialsJson: Record<string, unknown>): Promise<void>;

  fetchAndNormalizeImport(
    job: ProviderImportJobRecord,
    credentialsJson: Record<string, unknown>,
  ): Promise<ProviderReplaceImportPayload>;

  resolveImportIdentity(
    cache: Map<string, ResolvedImportIdentity | null>,
    params: ImportIdentityLookup,
  ): Promise<ResolvedImportIdentity | null>;
}

export type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export type ProviderSessionStateLookup = {
  profileId: string;
  provider: import('./provider-import.types.js').ProviderImportProvider;
  credentialsJson: Record<string, unknown>;
  providerUserId: string | null;
  externalUsername: string | null;
  lastImportCompletedAt: string | null;
};

export type ProviderSessionRecordLike = Pick<ProviderSessionRecord, 'profileId' | 'provider' | 'credentialsJson' | 'providerUserId' | 'externalUsername' | 'lastImportCompletedAt'>;
