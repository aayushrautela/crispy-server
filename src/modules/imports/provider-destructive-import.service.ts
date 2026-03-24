import { randomUUID } from 'node:crypto';
import type { DbClient } from '../../lib/db.js';
import { RecommendationEventOutboxRepository } from '../recommendations/recommendation-event-outbox.repo.js';
import { RecommendationOutputService } from '../recommendations/recommendation-output.service.js';
import { RecommendationWorkStateRepository } from '../recommendations/recommendation-work-state.repo.js';
import { ProjectionRebuildService, type ProjectionRebuildSummary } from '../watch/projection-rebuild.service.js';
import { parseMediaKey, type MediaIdentity } from '../watch/media-key.js';
import { HeartbeatBufferService } from '../watch/heartbeat-buffer.service.js';
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
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  rating?: number | null;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

export type ImportedHistoryEntryDraft = {
  mediaKey: string;
  mediaType: string;
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
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
  ) {}

  async replaceProfileWatchData(client: DbClient, params: {
    job: ProviderImportJobRecord;
    provider: ProviderImportProvider;
    payload: ProviderReplaceImportPayload;
  }): Promise<ProviderReplaceImportResult> {
    const { job, provider, payload } = params;
    const resetAt = payload.importedAt;
    const sortedEvents = [...payload.importedEvents].sort(compareOccurredAt);
    const sortedHistoryEntries = [...payload.importedHistoryEntries].sort((left, right) => left.watchedAt.localeCompare(right.watchedAt));
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
      householdId: job.householdId,
      provider,
      historyGeneration: watchDataState.historyGeneration,
      importedEvents: sortedEvents,
    });

    const insertedHistoryEntries = await this.insertImportedHistoryEntries(client, {
      profileId: job.profileId,
      householdId: job.householdId,
      provider,
      importedHistoryEntries: sortedHistoryEntries,
    });

    const projectionSummary = await this.projectionRebuildService.rebuildProfile(client, job.profileId);

    await this.recommendationEventOutboxRepository.append(client, {
      profileId: job.profileId,
      historyGeneration: watchDataState.historyGeneration,
      eventType: 'history_reset',
      occurredAt: payload.importedAt,
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
      occurredAt: payload.importedAt,
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
      completedAt: payload.importedAt,
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
    householdId: string;
    provider: ProviderImportProvider;
    historyGeneration: number;
    importedEvents: ImportedWatchEventDraft[];
  }): Promise<number> {
    let inserted = 0;
    for (const event of params.importedEvents) {
      const eventId = randomUUID();
      const identity = identityFromDraft(event);
      await client.query(
        `
          INSERT INTO watch_events (
            id,
            household_id,
            profile_id,
            client_event_id,
            event_type,
            media_key,
            media_type,
            tmdb_id,
            show_tmdb_id,
            season_number,
            episode_number,
            title,
            subtitle,
            poster_url,
            backdrop_url,
            position_seconds,
            duration_seconds,
            progress_percent,
            rating,
            occurred_at,
            payload
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            NULL,
            NULL,
            NULL,
            NULL,
            $12,
            $13,
            CASE
              WHEN $12 IS NOT NULL AND $13 IS NOT NULL AND $13 > 0
                THEN ROUND(($12::numeric / $13::numeric) * 100, 2)
              ELSE NULL
            END,
            $14,
            $15::timestamptz,
            $16::jsonb
          )
        `,
        [
          eventId,
          params.householdId,
          params.profileId,
          event.clientEventId ?? `provider-import:${params.provider}:${params.profileId}:${inserted}:${event.occurredAt}:${randomUUID()}`,
          event.eventType,
          identity.mediaKey,
          identity.mediaType,
          identity.tmdbId,
          identity.showTmdbId,
          identity.seasonNumber,
          identity.episodeNumber,
          event.positionSeconds ?? null,
          event.durationSeconds ?? null,
          event.rating ?? null,
          event.occurredAt,
          JSON.stringify({
            ...event.payload,
            import_provider: params.provider,
            import_history_generation: params.historyGeneration,
          }),
        ],
      );

      if (event.eventType === 'mark_watched' || event.eventType === 'playback_completed') {
        await this.recommendationEventOutboxRepository.append(client, {
          profileId: params.profileId,
          historyGeneration: params.historyGeneration,
          eventType: event.eventType,
          mediaKey: identity.mediaKey,
          mediaType: identity.mediaType,
          tmdbId: identity.tmdbId,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
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
          tmdbId: identity.tmdbId,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
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
    householdId: string;
    provider: ProviderImportProvider;
    importedHistoryEntries: ImportedHistoryEntryDraft[];
  }): Promise<number> {
    let inserted = 0;
    for (const entry of params.importedHistoryEntries) {
      const identity = identityFromDraft(entry);
      await this.watchHistoryEntriesRepository.append(client, {
        profileId: params.profileId,
        householdId: params.householdId,
        mediaKey: identity.mediaKey,
        mediaType: identity.mediaType,
        tmdbId: identity.tmdbId,
        showTmdbId: identity.showTmdbId,
        seasonNumber: identity.seasonNumber,
        episodeNumber: identity.episodeNumber,
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
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): MediaIdentity {
  const parsed = parseMediaKey(draft.mediaKey);
  return {
    mediaKey: parsed.mediaKey,
    mediaType: parsed.mediaType,
    tmdbId: draft.tmdbId ?? parsed.tmdbId,
    showTmdbId: draft.showTmdbId ?? parsed.showTmdbId,
    seasonNumber: draft.seasonNumber ?? parsed.seasonNumber,
    episodeNumber: draft.episodeNumber ?? parsed.episodeNumber,
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
