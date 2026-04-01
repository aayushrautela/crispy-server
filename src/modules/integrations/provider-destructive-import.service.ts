import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import { requireNormalizedIsoString } from '../../lib/time.js';
import { RecommendationEventOutboxRepository } from '../recommendations/recommendation-event-outbox.repo.js';
import { RecommendationOutputService } from '../recommendations/recommendation-output.service.js';
import { RecommendationWorkStateRepository } from '../recommendations/recommendation-work-state.repo.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import { ProjectionRebuildService, type ProjectionRebuildSummary } from '../watch/projection-rebuild.service.js';
import { ensureSupportedProvider, parseMediaKey, type MediaIdentity, type SupportedProvider } from '../identity/media-key.js';
import { HeartbeatBufferService } from '../watch/heartbeat-buffer.service.js';
import { WatchEventsRepository } from '../watch/watch-events.repo.js';
import { ProfileWatchDataStateRepository, type ProfileWatchDataStateRecord } from './profile-watch-data-state.repo.js';
import type { ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import type { ProviderImportProvider } from './provider-import.types.js';
import { WatchHistoryEntriesRepository } from './watch-history-entries.repo.js';

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
  projectionSummary: ProjectionRebuildSummary;
  insertedEvents: number;
  insertedHistoryEntries: number;
  mediaKeysToRefresh: string[];
};

export class ProviderDestructiveImportService {
  constructor(
    private readonly watchDataStateRepository = new ProfileWatchDataStateRepository(),
    private readonly watchHistoryEntriesRepository = new WatchHistoryEntriesRepository(),
    private readonly recommendationEventOutboxRepository = new RecommendationEventOutboxRepository(),
    private readonly recommendationOutputService = new RecommendationOutputService(),
    private readonly recommendationWorkStateRepository = new RecommendationWorkStateRepository(),
    private readonly projectionRebuildService = new ProjectionRebuildService(),
    private readonly heartbeatBufferService = new HeartbeatBufferService(),
    private readonly watchEventsRepository = new WatchEventsRepository(),
    private readonly metadataProjectionService = new MetadataProjectionService(),
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
      profileGroupId: job.profileGroupId,
      provider,
      historyGeneration: watchDataState.historyGeneration,
      importedEvents: sortedEvents,
    });

    const insertedHistoryEntries = await this.insertImportedHistoryEntries(client, {
      profileId: job.profileId,
      profileGroupId: job.profileGroupId,
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
    await client.query(`DELETE FROM continue_watching_projection WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM watch_history WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM watchlist_items WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM ratings WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM media_progress WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_tracked_series WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM watch_events WHERE profile_id = $1::uuid`, [profileId]);
    await this.watchHistoryEntriesRepository.clearForProfile(client, profileId);
    await this.recommendationEventOutboxRepository.clearForProfile(client, profileId);
    await this.recommendationOutputService.clearOutputsForProfile(client, profileId);
    await this.recommendationWorkStateRepository.clearClaimsForProfile(client, profileId);
  }

  private async insertImportedEvents(client: DbClient, params: {
    profileId: string;
    profileGroupId: string;
    provider: ProviderImportProvider;
    historyGeneration: number;
    importedEvents: ImportedWatchEventDraft[];
  }): Promise<number> {
    let inserted = 0;
    for (const event of params.importedEvents) {
      const identity = identityFromDraft(event);
      const persistedEvent = await this.watchEventsRepository.insert(client, {
        profileGroupId: params.profileGroupId,
        profileId: params.profileId,
        input: {
          clientEventId: event.clientEventId ?? `provider-import:${params.provider}:${params.profileId}:${inserted}:${event.occurredAt}:${randomUUID()}`,
          eventType: event.eventType,
          mediaKey: identity.mediaKey,
          mediaType: identity.mediaType,
          provider: identity.provider,
          providerId: identity.providerId,
          parentProvider: identity.parentProvider,
          parentProviderId: identity.parentProviderId,
          tmdbId: identity.tmdbId,
          tvdbId: event.tvdbId ?? null,
          kitsuId: event.kitsuId ?? null,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
          absoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
          positionSeconds: event.positionSeconds ?? null,
          durationSeconds: event.durationSeconds ?? null,
          rating: event.rating ?? null,
          occurredAt: event.occurredAt,
          payload: {
            ...event.payload,
            import_provider: params.provider,
            import_history_generation: params.historyGeneration,
          },
        },
        identity,
        projection: await this.metadataProjectionService.buildWatchProjection(client, identity),
      });

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
          payload: {
            importProvider: params.provider,
          },
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
          payload: {
            importProvider: params.provider,
          },
        });
      }

      inserted += 1;
    }
    return inserted;
  }

  private async insertImportedHistoryEntries(client: DbClient, params: {
    profileId: string;
    profileGroupId: string;
    provider: ProviderImportProvider;
    importedHistoryEntries: ImportedHistoryEntryDraft[];
  }): Promise<number> {
    let inserted = 0;
    for (const entry of params.importedHistoryEntries) {
      const identity = identityFromDraft(entry);
      await this.watchHistoryEntriesRepository.append(client, {
        profileId: params.profileId,
        profileGroupId: params.profileGroupId,
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
        watchedAt: entry.watchedAt,
        sourceKind: entry.sourceKind,
        payload: {
          ...entry.payload,
          importProvider: params.provider,
        },
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
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function compareOccurredAt(left: ImportedWatchEventDraft, right: ImportedWatchEventDraft): number {
  const occurredAtComparison = left.occurredAt.localeCompare(right.occurredAt);
  if (occurredAtComparison !== 0) {
    return occurredAtComparison;
  }
  return left.eventType.localeCompare(right.eventType);
}
