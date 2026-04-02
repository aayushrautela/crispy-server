import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import { requireNormalizedIsoString } from '../../lib/time.js';
import { RecommendationEventOutboxRepository } from '../recommendations/recommendation-event-outbox.repo.js';
import { RecommendationOutputService } from '../recommendations/recommendation-output.service.js';
import { RecommendationWorkStateRepository } from '../recommendations/recommendation-work-state.repo.js';
import type { WatchV2ProjectionRebuildSummary } from '../watch-v2/watch-v2-projection-summary.js';
import { ensureSupportedProvider, parentMediaTypeForIdentity, parseMediaKey, type MediaIdentity, type SupportedProvider } from '../identity/media-key.js';
import { HeartbeatBufferService } from '../watch/heartbeat-buffer.service.js';
import { ProfileWatchDataStateRepository, type ProfileWatchDataStateRecord } from './profile-watch-data-state.repo.js';
import type { ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderImportProvider } from './provider-import.types.js';
import { WatchV2ProjectionRebuildService } from '../watch-v2/watch-v2-projection-rebuild.service.js';
import { WatchV2WriteRepository } from '../watch-v2/watch-v2-write.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { resolveWatchV2Lookup } from '../watch/watch-v2-utils.js';

export type ImportedWatchEventDraft = {
  clientEventId?: string;
  eventType:
    | 'playback_progress_snapshot'
    | 'playback_completed'
    | 'mark_watched'
    | 'watchlist_put'
    | 'rating_put';
  mediaKey: string;
  mediaType: string;
  provider?: SupportedProvider | null;
  providerId?: string | null;
  parentProvider?: SupportedProvider | null;
  parentProviderId?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | null;
  kitsuId?: string | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  rating?: number | null;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

export type ImportedHistoryEntryDraft = {
  mediaKey: string;
  mediaType: string;
  provider?: SupportedProvider | null;
  providerId?: string | null;
  parentProvider?: SupportedProvider | null;
  parentProviderId?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | null;
  kitsuId?: string | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
  watchedAt: string;
  sourceKind: string;
  payload?: Record<string, unknown>;
};

export type ProviderReplaceImportPayload = {
  importedEvents: ImportedWatchEventDraft[];
  importedHistoryEntries: ImportedHistoryEntryDraft[];
  importedAt: string;
  importSummary: Record<string, unknown>;
  mediaKeysToRefresh?: string[];
};

export type ProviderReplaceImportResult = {
  watchDataState: ProfileWatchDataStateRecord;
  projectionSummary: WatchV2ProjectionRebuildSummary;
  insertedEvents: number;
  insertedHistoryEntries: number;
  mediaKeysToRefresh: string[];
};

export class ProviderDestructiveImportService {
  constructor(
    private readonly watchDataStateRepository = new ProfileWatchDataStateRepository(),
    private readonly recommendationEventOutboxRepository = new RecommendationEventOutboxRepository(),
    private readonly recommendationOutputService = new RecommendationOutputService(),
    private readonly recommendationWorkStateRepository = new RecommendationWorkStateRepository(),
    private readonly projectionRebuildService = new WatchV2ProjectionRebuildService(),
    private readonly heartbeatBufferService = new HeartbeatBufferService(),
    private readonly watchV2Repository = new WatchV2WriteRepository(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async replaceProfileWatchData(client: DbClient, params: {
    job: ProviderImportJobRecord;
    provider: ProviderImportProvider;
    payload: ProviderReplaceImportPayload;
  }): Promise<ProviderReplaceImportResult> {
    const { job, provider, payload } = params;
    const resetAt = requireNormalizedIsoString(payload.importedAt, 'importedAt');
    const normalizedEvents = payload.importedEvents.map((event) => ({
      ...event,
      occurredAt: requireNormalizedIsoString(event.occurredAt, 'occurredAt'),
    }));
    const normalizedHistoryEntries = payload.importedHistoryEntries.map((entry) => ({
      ...entry,
      watchedAt: requireNormalizedIsoString(entry.watchedAt, 'watchedAt'),
    }));
    const sortedEvents = [...normalizedEvents].sort(compareOccurredAt);
    const sortedHistoryEntries = [...normalizedHistoryEntries].sort((left, right) => left.watchedAt.localeCompare(right.watchedAt));
    const mediaKeysToRefresh = dedupeMediaKeys([
      ...(payload.mediaKeysToRefresh ?? []),
      ...collectMediaKeys(sortedEvents),
    ]);

    const watchDataState = await this.watchDataStateRepository.markResetForImport(client, {
      profileId: job.profileId,
      provider,
      importJobId: job.id,
      resetAt,
    });

    await this.clearExistingServerState(client, job.profileId);

    const insertedEvents = await this.insertImportedEvents(client, {
      profileId: job.profileId,
      provider,
      historyGeneration: watchDataState.historyGeneration,
      importedEvents: sortedEvents,
    });

    const insertedHistoryEntries = await this.insertImportedHistoryEntries(client, {
      profileId: job.profileId,
      provider,
      importedHistoryEntries: sortedHistoryEntries,
    });

    const projectionSummary = await this.projectionRebuildService.rebuildProfile(client, job.profileId);

    await this.recommendationEventOutboxRepository.append(client, {
      profileId: job.profileId,
      historyGeneration: watchDataState.historyGeneration,
      eventType: 'history_reset',
      occurredAt: resetAt,
      payload: {
        provider,
        importJobId: job.id,
        importSummary: payload.importSummary,
      },
    });

    await this.recommendationEventOutboxRepository.append(client, {
      profileId: job.profileId,
      historyGeneration: watchDataState.historyGeneration,
      eventType: 'provider_import_completed',
      occurredAt: resetAt,
      payload: {
        provider,
        importJobId: job.id,
        insertedEvents,
        insertedHistoryEntries,
        importSummary: payload.importSummary,
      },
    });

    const completedState = await this.watchDataStateRepository.markImportCompleted(client, {
      profileId: job.profileId,
      provider,
      importJobId: job.id,
      completedAt: resetAt,
    });

    return {
      watchDataState: completedState,
      projectionSummary,
      insertedEvents,
      insertedHistoryEntries,
      mediaKeysToRefresh,
    };
  }

  async clearBufferedPlayback(profileId: string): Promise<number> {
    return this.heartbeatBufferService.clearAllForProfile(profileId);
  }

  private async clearExistingServerState(client: DbClient, profileId: string): Promise<void> {
    await client.query(`DELETE FROM profile_title_projection WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_tracked_title_state WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_play_history WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_rating_state WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_watchlist_state WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_watch_override WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_playable_state WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_watch_clock WHERE profile_id = $1::uuid`, [profileId]);
    await this.recommendationEventOutboxRepository.clearForProfile(client, profileId);
    await this.recommendationOutputService.clearOutputsForProfile(client, profileId);
    await this.recommendationWorkStateRepository.clearClaimsForProfile(client, profileId);
  }

  private async insertImportedEvents(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    historyGeneration: number;
    importedEvents: ImportedWatchEventDraft[];
  }): Promise<number> {
    let inserted = 0;
    for (const event of params.importedEvents) {
      const identity = identityFromDraft(event);
      const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, identity);
      const mutationSeq = await this.watchV2Repository.reserveMutationSequence(client, params.profileId);

      if (event.eventType === 'mark_watched' || event.eventType === 'playback_completed') {
        const playable = identity.mediaType === 'movie' || identity.mediaType === 'episode';
        await this.watchV2Repository.upsertWatchOverride(client, {
          profileId: params.profileId,
          targetContentId: lookup.contentId,
          targetKind: identity.mediaType === 'show' || identity.mediaType === 'anime' ? identity.mediaType : (identity.mediaType === 'movie' ? 'movie' : 'episode'),
          overrideState: 'watched',
          scope: identity.mediaType === 'show' || identity.mediaType === 'anime' ? 'released_descendants' : 'self',
          appliesThroughReleaseAt: identity.mediaType === 'show' || identity.mediaType === 'anime' ? event.occurredAt : null,
          lastMutationSeq: mutationSeq,
          sourceKind: providerToSourceKind(params.provider),
          sourceProvider: params.provider,
          sourceUpdatedAt: event.occurredAt,
        });
        if (playable) {
          await this.watchV2Repository.upsertPlayableState(client, {
            profileId: params.profileId,
            contentId: lookup.contentId,
            titleContentId: lookup.titleContentId,
            playbackStatus: 'completed',
            positionSeconds: 0,
            durationSeconds: event.durationSeconds ?? null,
            progressPercent: 100,
            playCount: 1,
            firstCompletedAt: event.occurredAt,
            lastCompletedAt: event.occurredAt,
            lastActivityAt: event.occurredAt,
            dismissedAt: null,
            lastMutationSeq: mutationSeq,
            sourceKind: providerToSourceKind(params.provider),
            sourceProvider: params.provider,
            sourceUpdatedAt: event.occurredAt,
          });
        }
        await this.watchV2Repository.insertPlayHistory(client, {
          profileId: params.profileId,
          contentId: lookup.contentId,
          titleContentId: lookup.titleContentId,
          completedAt: event.occurredAt,
          lastMutationSeq: mutationSeq,
          sourceKind: providerToSourceKind(params.provider),
          sourceProvider: params.provider,
        });
      } else if (event.eventType === 'watchlist_put') {
        await this.watchV2Repository.upsertWatchlistState(client, {
          profileId: params.profileId,
          targetContentId: lookup.titleContentId,
          targetKind: lookup.titleIdentity.mediaType as 'movie' | 'show' | 'anime',
          present: true,
          addedAt: event.occurredAt,
          removedAt: null,
          lastMutationSeq: mutationSeq,
          sourceKind: providerToSourceKind(params.provider),
          sourceProvider: params.provider,
          sourceUpdatedAt: event.occurredAt,
        });
      } else if (event.eventType === 'rating_put') {
        await this.watchV2Repository.upsertRatingState(client, {
          profileId: params.profileId,
          targetContentId: lookup.titleContentId,
          targetKind: lookup.titleIdentity.mediaType as 'movie' | 'show' | 'anime',
          rating: event.rating ?? null,
          ratedAt: event.occurredAt,
          removedAt: null,
          lastMutationSeq: mutationSeq,
          sourceKind: providerToSourceKind(params.provider),
          sourceProvider: params.provider,
          sourceUpdatedAt: event.occurredAt,
        });
      } else if (event.eventType === 'playback_progress_snapshot') {
        await this.watchV2Repository.upsertPlayableState(client, {
          profileId: params.profileId,
          contentId: lookup.contentId,
          titleContentId: lookup.titleContentId,
          playbackStatus: (event.positionSeconds ?? 0) > 0 ? 'in_progress' : 'idle',
          positionSeconds: Math.max(0, event.positionSeconds ?? 0),
          durationSeconds: event.durationSeconds ?? null,
          progressPercent: event.durationSeconds && event.durationSeconds > 0 ? Math.min(100, Math.max(0, (event.positionSeconds ?? 0) / event.durationSeconds * 100)) : 0,
          playCount: 0,
          firstCompletedAt: null,
          lastCompletedAt: null,
          lastActivityAt: event.occurredAt,
          dismissedAt: null,
          lastMutationSeq: mutationSeq,
          sourceKind: providerToSourceKind(params.provider),
          sourceProvider: params.provider,
          sourceUpdatedAt: event.occurredAt,
        });
      }

      if (event.eventType === 'mark_watched' || event.eventType === 'playback_completed') {
        await this.recommendationEventOutboxRepository.append(client, {
          profileId: params.profileId,
          historyGeneration: params.historyGeneration,
          eventType: event.eventType,
          mediaKey: identity.mediaKey,
          mediaType: identity.mediaType,
          provider: identity.provider,
          providerId: identity.providerId,
          parentProvider: identity.parentProvider,
          parentProviderId: identity.parentProviderId,
          tmdbId: identity.tmdbId,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
          absoluteEpisodeNumber: identity.absoluteEpisodeNumber,
          occurredAt: event.occurredAt,
          payload: { importProvider: params.provider },
        });
      } else if (event.eventType === 'rating_put') {
        await this.recommendationEventOutboxRepository.append(client, {
          profileId: params.profileId,
          historyGeneration: params.historyGeneration,
          eventType: 'rating_put',
          mediaKey: identity.mediaKey,
          mediaType: identity.mediaType,
          provider: identity.provider,
          providerId: identity.providerId,
          parentProvider: identity.parentProvider,
          parentProviderId: identity.parentProviderId,
          tmdbId: identity.tmdbId,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
          absoluteEpisodeNumber: identity.absoluteEpisodeNumber,
          rating: event.rating ?? null,
          occurredAt: event.occurredAt,
          payload: { importProvider: params.provider },
        });
      }

      inserted += 1;
    }
    return inserted;
  }

  private async insertImportedHistoryEntries(client: DbClient, params: {
    profileId: string;
    provider: ProviderImportProvider;
    importedHistoryEntries: ImportedHistoryEntryDraft[];
  }): Promise<number> {
    let inserted = 0;
    for (const entry of params.importedHistoryEntries) {
      const identity = identityFromDraft(entry);
      const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, identity);
      const mutationSeq = await this.watchV2Repository.reserveMutationSequence(client, params.profileId);
      await this.watchV2Repository.insertPlayHistory(client, {
        profileId: params.profileId,
        contentId: lookup.contentId,
        titleContentId: lookup.titleContentId,
        completedAt: entry.watchedAt,
        lastMutationSeq: mutationSeq,
        sourceKind: providerToSourceKind(params.provider),
        sourceProvider: params.provider,
      });
      inserted += 1;
    }
    return inserted;
  }

}

function identityFromDraft(draft: {
  mediaKey: string;
  mediaType: string;
  provider?: SupportedProvider | null;
  providerId?: string | null;
  parentProvider?: SupportedProvider | null;
  parentProviderId?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | null;
  kitsuId?: string | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
}): MediaIdentity {
  const parsed = parseMediaKey(draft.mediaKey);
  return {
    ...parsed,
    provider: draft.provider ? ensureSupportedProvider(draft.provider) : parsed.provider,
    providerId: draft.providerId ?? parsed.providerId,
    parentProvider: draft.parentProvider ? ensureSupportedProvider(draft.parentProvider) : parsed.parentProvider,
    parentProviderId: draft.parentProviderId ?? parsed.parentProviderId,
    tmdbId: draft.tmdbId ?? parsed.tmdbId,
    providerMetadata: parsed.providerMetadata,
    showTmdbId: draft.showTmdbId ?? parsed.showTmdbId,
    seasonNumber: draft.seasonNumber ?? parsed.seasonNumber,
    episodeNumber: draft.episodeNumber ?? parsed.episodeNumber,
    absoluteEpisodeNumber: draft.absoluteEpisodeNumber ?? parsed.absoluteEpisodeNumber,
  };
}

function collectMediaKeys(importedEvents: ImportedWatchEventDraft[]): string[] {
  const keys = new Set<string>();
  for (const event of importedEvents) {
    if (event.mediaKey.trim()) {
      keys.add(event.mediaKey.trim());
    }
  }
  return Array.from(keys);
}

function dedupeMediaKeys(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeRefreshMediaKey(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeRefreshMediaKey(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }

  try {
    const identity = parseMediaKey(normalized);
    if ((identity.mediaType === 'season' || identity.mediaType === 'episode') && identity.parentProvider && identity.parentProviderId) {
      // Metadata refresh tracks series-level state, so refreshing every episode just repeats the same show work.
      return `${parentMediaTypeForIdentity(identity)}:${identity.parentProvider}:${identity.parentProviderId}`;
    }
  } catch {
    return normalized;
  }

  return normalized;
}

function compareOccurredAt(left: ImportedWatchEventDraft, right: ImportedWatchEventDraft): number {
  const occurredAtComparison = left.occurredAt.localeCompare(right.occurredAt);
  if (occurredAtComparison !== 0) {
    return occurredAtComparison;
  }
  return left.eventType.localeCompare(right.eventType);
}

function providerToSourceKind(provider: ProviderImportProvider): 'provider_import' {
  void provider;
  return 'provider_import';
}
