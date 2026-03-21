import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { extractNextEpisodeToAir } from '../metadata/tmdb-episode-helpers.js';
import { TmdbCacheService } from '../metadata/tmdb-cache.service.js';
import { deriveProgressPercent } from './heartbeat-policy.js';
import { showTmdbIdForIdentity, type MediaIdentity } from './media-key.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { MediaProgressRepository } from './media-progress.repo.js';
import { RatingsRepository } from './ratings.repo.js';
import { TrackedSeriesRepository } from './tracked-series.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';

export class WatchProjectorService {
  constructor(
    private readonly mediaProgressRepository = new MediaProgressRepository(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
    private readonly trackedSeriesRepository = new TrackedSeriesRepository(),
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async applyPlaybackEvent(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    eventType: string;
    occurredAt: string;
    positionSeconds?: number | null;
    durationSeconds?: number | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.refreshMetadataReferences(client, params.profileId, params.identity, params.eventId, params.occurredAt, params.payload);

    const current = await this.mediaProgressRepository.getByMediaKey(client, params.profileId, params.identity.mediaKey);
    if (current && Date.parse(params.occurredAt) < Date.parse(current.lastPlayedAt)) {
      throw new HttpError(409, 'Incoming playback event is older than current progress.');
    }

    const progressPercent = deriveProgressPercent(params.positionSeconds, params.durationSeconds);
    const status = progressPercent >= 90 || params.eventType === 'playback_completed' ? 'completed' : 'in_progress';

    await this.mediaProgressRepository.upsert(client, {
      profileId: params.profileId,
      identity: params.identity,
      eventId: params.eventId,
      positionSeconds: params.positionSeconds,
      durationSeconds: params.durationSeconds,
      occurredAt: params.occurredAt,
      status,
      payload: params.payload,
    });

    if (status === 'completed') {
      await this.watchHistoryRepository.upsertWatched(client, {
        profileId: params.profileId,
        identity: params.identity,
        watchedAt: params.occurredAt,
        sourceEventId: params.eventId,
        payload: params.payload,
      });
      await this.continueWatchingRepository.delete(client, params.profileId, params.identity.mediaKey);
      return;
    }

    if ((params.positionSeconds ?? 0) <= 0) {
      return;
    }

    await this.continueWatchingRepository.upsert(client, {
      profileId: params.profileId,
      identity: params.identity,
      positionSeconds: params.positionSeconds,
      durationSeconds: params.durationSeconds,
      occurredAt: params.occurredAt,
      payload: params.payload,
    });
  }

  async markWatched(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    occurredAt: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.refreshMetadataReferences(client, params.profileId, params.identity, params.eventId, params.occurredAt, params.payload);
    await this.watchHistoryRepository.upsertWatched(client, {
      profileId: params.profileId,
      identity: params.identity,
      watchedAt: params.occurredAt,
      sourceEventId: params.eventId,
      payload: params.payload,
    });
    await this.continueWatchingRepository.delete(client, params.profileId, params.identity.mediaKey);
    await this.mediaProgressRepository.upsert(client, {
      profileId: params.profileId,
      identity: params.identity,
      eventId: params.eventId,
      occurredAt: params.occurredAt,
      status: 'completed',
      payload: params.payload,
    });
  }

  async unmarkWatched(client: DbClient, params: { profileId: string; mediaKey: string }): Promise<void> {
    await this.watchHistoryRepository.deleteWatched(client, params.profileId, params.mediaKey);
  }

  async setWatchlist(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    occurredAt: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.refreshMetadataReferences(client, params.profileId, params.identity, params.eventId, params.occurredAt, params.payload, 'watchlist');
    await this.watchlistRepository.put(client, {
      profileId: params.profileId,
      identity: params.identity,
      sourceEventId: params.eventId,
      addedAt: params.occurredAt,
      payload: params.payload,
    });
  }

  async removeWatchlist(client: DbClient, params: { profileId: string; mediaKey: string }): Promise<void> {
    await this.watchlistRepository.delete(client, params.profileId, params.mediaKey);
  }

  async setRating(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    occurredAt: string;
    rating: number;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.refreshMetadataReferences(client, params.profileId, params.identity, params.eventId, params.occurredAt, params.payload, 'rating');
    await this.ratingsRepository.put(client, {
      profileId: params.profileId,
      identity: params.identity,
      sourceEventId: params.eventId,
      ratedAt: params.occurredAt,
      rating: params.rating,
      payload: params.payload,
    });
  }

  async removeRating(client: DbClient, params: { profileId: string; mediaKey: string }): Promise<void> {
    await this.ratingsRepository.delete(client, params.profileId, params.mediaKey);
  }

  async dismissContinueWatching(client: DbClient, params: { profileId: string; projectionId: string }): Promise<void> {
    await this.continueWatchingRepository.dismissById(client, params.profileId, params.projectionId);
  }

  private async refreshMetadataReferences(
    client: DbClient,
    profileId: string,
    identity: MediaIdentity,
    eventId: string,
    occurredAt: string,
    payload?: Record<string, unknown>,
    reason = 'watch_activity',
  ): Promise<void> {
    const showTmdbId = showTmdbIdForIdentity(identity);
    if (!showTmdbId) {
      if (identity.mediaType === 'movie' && identity.tmdbId) {
        await this.tmdbCacheService.getTitle(client, 'movie', identity.tmdbId);
      }
      return;
    }

    const title = await this.tmdbCacheService.getTitle(client, 'tv', showTmdbId);
    const nextEpisode = extractNextEpisodeToAir(title);

    await this.trackedSeriesRepository.upsert(client, {
      profileId,
      showTmdbId,
      reason,
      lastSourceEventId: eventId,
      lastInteractedAt: occurredAt,
      payload,
    });

    await this.trackedSeriesRepository.updateMetadataState(client, {
      profileId,
      showTmdbId,
      nextEpisodeAirDate: nextEpisode?.airDate ?? null,
      metadataRefreshedAt: new Date().toISOString(),
    });
  }
}
