import type { DbClient } from '../../lib/db.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { canonicalContinueWatchingMediaKey, ensureSupportedMediaType, inferMediaIdentity, showTmdbIdForIdentity, type MediaIdentity } from './media-key.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { deriveProgressPercent } from './heartbeat-policy.js';
import { MediaProgressRepository } from './media-progress.repo.js';
import { RatingsRepository } from './ratings.repo.js';
import { TrackedSeriesRepository } from './tracked-series.repo.js';
import { WatchEventsRepository, type RebuildableWatchEvent } from './watch-events.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';
import type { WatchMediaProjection } from './watch.types.js';

type FoldedProgress = {
  identity: MediaIdentity;
  eventId: string;
  occurredAt: string;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  status: string;
  dismissedAt?: string | null;
  payload?: Record<string, unknown>;
  projection?: WatchMediaProjection;
};

type FoldedContinueWatching = {
  identity: MediaIdentity;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  occurredAt: string;
  dismissedAt?: string | null;
  payload?: Record<string, unknown>;
  projection?: WatchMediaProjection;
};

type FoldedWatchHistory = {
  identity: MediaIdentity;
  watchedAt: string;
  sourceEventId: string;
  payload?: Record<string, unknown>;
  projection?: WatchMediaProjection;
};

type FoldedWatchlist = {
  identity: MediaIdentity;
  addedAt: string;
  sourceEventId: string;
  payload?: Record<string, unknown>;
  projection?: WatchMediaProjection;
};

type FoldedRating = {
  identity: MediaIdentity;
  ratedAt: string;
  sourceEventId: string;
  rating: number;
  payload?: Record<string, unknown>;
  projection?: WatchMediaProjection;
};

type FoldedTrackedSeries = {
  showTmdbId: number;
  reason: string;
  lastSourceEventId: string;
  lastInteractedAt: string;
  payload?: Record<string, unknown>;
};

export type ProjectionRebuildSummary = {
  eventsScanned: number;
  mediaProgressRows: number;
  watchHistoryRows: number;
  watchlistRows: number;
  ratingRows: number;
  continueWatchingRows: number;
  trackedSeriesRows: number;
  metadataRefreshRecommended: boolean;
};

export class ProjectionRebuildService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly watchEventsRepository = new WatchEventsRepository(),
    private readonly mediaProgressRepository = new MediaProgressRepository(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
    private readonly trackedSeriesRepository = new TrackedSeriesRepository(),
  ) {}

  async rebuildProfile(client: DbClient, profileId: string): Promise<ProjectionRebuildSummary> {
    const profile = await this.profileRepository.findById(client, profileId);
    if (!profile) {
      throw new Error(`Profile ${profileId} not found.`);
    }

    const events = await this.watchEventsRepository.listForProfile(client, profileId);
    const folded = foldEvents(events);

    await this.clearExistingProjections(client, profileId);

    for (const row of folded.mediaProgress.values()) {
      await this.mediaProgressRepository.upsert(client, {
        profileId,
        identity: row.identity,
        eventId: row.eventId,
        positionSeconds: row.positionSeconds,
        durationSeconds: row.durationSeconds,
        occurredAt: row.occurredAt,
        status: row.status,
        dismissedAt: row.dismissedAt,
        payload: row.payload,
        projection: row.projection,
      });
    }

    for (const row of folded.watchHistory.values()) {
      await this.watchHistoryRepository.upsertWatched(client, {
        profileId,
        identity: row.identity,
        watchedAt: row.watchedAt,
        sourceEventId: row.sourceEventId,
        payload: row.payload,
        projection: row.projection,
      });
    }

    for (const row of folded.watchlist.values()) {
      await this.watchlistRepository.put(client, {
        profileId,
        identity: row.identity,
        addedAt: row.addedAt,
        sourceEventId: row.sourceEventId,
        payload: row.payload,
        projection: row.projection,
      });
    }

    for (const row of folded.ratings.values()) {
      await this.ratingsRepository.put(client, {
        profileId,
        identity: row.identity,
        ratedAt: row.ratedAt,
        sourceEventId: row.sourceEventId,
        rating: row.rating,
        payload: row.payload,
        projection: row.projection,
      });
    }

    for (const row of folded.continueWatching.values()) {
      await this.continueWatchingRepository.upsert(client, {
        profileId,
        identity: row.identity,
        positionSeconds: row.positionSeconds,
        durationSeconds: row.durationSeconds,
        occurredAt: row.occurredAt,
        dismissedAt: row.dismissedAt,
        payload: row.payload,
        projection: row.projection,
      });
    }

    for (const row of folded.trackedSeries.values()) {
      await this.trackedSeriesRepository.upsert(client, {
        profileId,
        showTmdbId: row.showTmdbId,
        reason: row.reason,
        lastSourceEventId: row.lastSourceEventId,
        lastInteractedAt: row.lastInteractedAt,
        payload: row.payload,
      });
    }

    return {
      eventsScanned: events.length,
      mediaProgressRows: folded.mediaProgress.size,
      watchHistoryRows: folded.watchHistory.size,
      watchlistRows: folded.watchlist.size,
      ratingRows: folded.ratings.size,
      continueWatchingRows: folded.continueWatching.size,
      trackedSeriesRows: folded.trackedSeries.size,
      metadataRefreshRecommended: folded.trackedSeries.size > 0,
    };
  }

  private async clearExistingProjections(client: DbClient, profileId: string): Promise<void> {
    await client.query(`DELETE FROM continue_watching_projection WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM watch_history WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM watchlist_items WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM ratings WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM media_progress WHERE profile_id = $1::uuid`, [profileId]);
    await client.query(`DELETE FROM profile_tracked_series WHERE profile_id = $1::uuid`, [profileId]);
  }
}

function foldEvents(events: RebuildableWatchEvent[]): {
  mediaProgress: Map<string, FoldedProgress>;
  continueWatching: Map<string, FoldedContinueWatching>;
  watchHistory: Map<string, FoldedWatchHistory>;
  watchlist: Map<string, FoldedWatchlist>;
  ratings: Map<string, FoldedRating>;
  trackedSeries: Map<number, FoldedTrackedSeries>;
} {
  const mediaProgress = new Map<string, FoldedProgress>();
  const continueWatching = new Map<string, FoldedContinueWatching>();
  const watchHistory = new Map<string, FoldedWatchHistory>();
  const watchlist = new Map<string, FoldedWatchlist>();
  const ratings = new Map<string, FoldedRating>();
  const trackedSeries = new Map<number, FoldedTrackedSeries>();

  for (const event of events) {
    const identity = identityFromEvent(event);
    const showTmdbId = showTmdbIdForIdentity(identity);

    if (showTmdbId && shouldTrackSeries(event.eventType)) {
      trackedSeries.set(showTmdbId, {
        showTmdbId,
        reason: trackedSeriesReason(event.eventType),
        lastSourceEventId: event.id,
        lastInteractedAt: event.occurredAt,
        payload: event.payload,
      });
    }

    switch (event.eventType) {
      case 'mark_watched': {
        const continueWatchingKey = canonicalContinueWatchingMediaKey(identity);
        watchHistory.set(identity.mediaKey, {
          identity,
          watchedAt: event.occurredAt,
          sourceEventId: event.id,
          payload: event.payload,
          projection: projectionFromEvent(event),
        });
        continueWatching.delete(continueWatchingKey);
        mediaProgress.set(identity.mediaKey, {
          identity,
          eventId: event.id,
          occurredAt: event.occurredAt,
          status: 'completed',
          positionSeconds: 0,
          durationSeconds: null,
          dismissedAt: null,
          payload: event.payload,
        });
        break;
      }
      case 'unmark_watched':
        watchHistory.delete(identity.mediaKey);
        break;
      case 'watchlist_put':
        watchlist.set(identity.mediaKey, {
          identity,
          addedAt: event.occurredAt,
          sourceEventId: event.id,
          payload: event.payload,
        });
        break;
      case 'watchlist_remove':
        watchlist.delete(identity.mediaKey);
        break;
      case 'rating_put':
        if (typeof event.rating === 'number') {
          ratings.set(identity.mediaKey, {
            identity,
            ratedAt: event.occurredAt,
            sourceEventId: event.id,
            rating: event.rating,
            payload: event.payload,
            projection: projectionFromEvent(event),
          });
        }
        break;
      case 'rating_remove':
        ratings.delete(identity.mediaKey);
        break;
      case 'continue_watching_dismissed': {
        const continueWatchingKey = canonicalContinueWatchingMediaKey(identity);
        const currentProgress = mediaProgress.get(identity.mediaKey);
        if (currentProgress) {
          currentProgress.dismissedAt = event.occurredAt;
          mediaProgress.set(identity.mediaKey, currentProgress);
        }

        const currentContinueWatching = continueWatching.get(continueWatchingKey);
        if (currentContinueWatching) {
          currentContinueWatching.dismissedAt = event.occurredAt;
          continueWatching.set(continueWatchingKey, currentContinueWatching);
        }
        break;
      }
      default:
        foldPlaybackLikeEvent({
          event,
          identity,
          mediaProgress,
          continueWatching,
          watchHistory,
        });
        break;
    }
  }

  return {
    mediaProgress,
    continueWatching,
    watchHistory,
    watchlist,
    ratings,
    trackedSeries,
  };
}

function foldPlaybackLikeEvent(params: {
  event: RebuildableWatchEvent;
  identity: MediaIdentity;
  mediaProgress: Map<string, FoldedProgress>;
  continueWatching: Map<string, FoldedContinueWatching>;
  watchHistory: Map<string, FoldedWatchHistory>;
}): void {
  const { event, identity, mediaProgress, continueWatching, watchHistory } = params;
  const continueWatchingKey = canonicalContinueWatchingMediaKey(identity);
  const progressPercent = deriveProgressPercent(event.positionSeconds, event.durationSeconds);
  const status = progressPercent >= 90 || event.eventType === 'playback_completed' ? 'completed' : 'in_progress';

  mediaProgress.set(identity.mediaKey, {
    identity,
    eventId: event.id,
    occurredAt: event.occurredAt,
    positionSeconds: event.positionSeconds,
    durationSeconds: event.durationSeconds,
    status,
    dismissedAt: null,
    payload: event.payload,
    projection: projectionFromEvent(event),
  });

  if (status === 'completed') {
    watchHistory.set(identity.mediaKey, {
      identity,
      watchedAt: event.occurredAt,
      sourceEventId: event.id,
      payload: event.payload,
      projection: projectionFromEvent(event),
    });
    continueWatching.delete(continueWatchingKey);
    return;
  }

  if ((event.positionSeconds ?? 0) <= 0) {
    return;
  }

  continueWatching.set(continueWatchingKey, {
    identity,
    positionSeconds: event.positionSeconds,
    durationSeconds: event.durationSeconds,
    occurredAt: event.occurredAt,
    dismissedAt: null,
    payload: event.payload,
    projection: projectionFromEvent(event),
  });
}

function projectionFromEvent(event: RebuildableWatchEvent): WatchMediaProjection {
  return {
    title: event.title,
    subtitle: event.subtitle,
    posterUrl: event.posterUrl,
    backdropUrl: event.backdropUrl,
  };
}

function identityFromEvent(event: RebuildableWatchEvent): MediaIdentity {
  return inferMediaIdentity({
    mediaKey: event.mediaKey,
    mediaType: ensureSupportedMediaType(event.mediaType),
    tmdbId: event.tmdbId,
    showTmdbId: event.showTmdbId,
    seasonNumber: event.seasonNumber,
    episodeNumber: event.episodeNumber,
  });
}

function shouldTrackSeries(eventType: string): boolean {
  return eventType === 'mark_watched'
    || eventType === 'watchlist_put'
    || eventType === 'rating_put'
    || eventType.startsWith('playback_');
}

function trackedSeriesReason(eventType: string): string {
  if (eventType === 'watchlist_put') {
    return 'watchlist';
  }
  if (eventType === 'rating_put') {
    return 'rating';
  }
  return 'watch_activity';
}
