import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { deriveProgressPercent } from './heartbeat-policy.js';
import type { MediaIdentity } from './media-key.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { MediaProgressRepository } from './media-progress.repo.js';
import { RatingsRepository } from './ratings.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';

export class WatchProjectorService {
  constructor(
    private readonly mediaProgressRepository = new MediaProgressRepository(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
  ) {}

  async applyPlaybackEvent(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    eventType: string;
    occurredAt: string;
    title?: string | null;
    subtitle?: string | null;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    positionSeconds?: number | null;
    durationSeconds?: number | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
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
      title: params.title,
      subtitle: params.subtitle,
      posterUrl: params.posterUrl,
      backdropUrl: params.backdropUrl,
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
        title: params.title,
        subtitle: params.subtitle,
        posterUrl: params.posterUrl,
        backdropUrl: params.backdropUrl,
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
      title: params.title,
      subtitle: params.subtitle,
      posterUrl: params.posterUrl,
      backdropUrl: params.backdropUrl,
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
    title?: string | null;
    subtitle?: string | null;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.watchHistoryRepository.upsertWatched(client, {
      profileId: params.profileId,
      identity: params.identity,
      watchedAt: params.occurredAt,
      sourceEventId: params.eventId,
      title: params.title,
      subtitle: params.subtitle,
      posterUrl: params.posterUrl,
      backdropUrl: params.backdropUrl,
      payload: params.payload,
    });
    await this.continueWatchingRepository.delete(client, params.profileId, params.identity.mediaKey);
    await this.mediaProgressRepository.upsert(client, {
      profileId: params.profileId,
      identity: params.identity,
      eventId: params.eventId,
      title: params.title,
      subtitle: params.subtitle,
      posterUrl: params.posterUrl,
      backdropUrl: params.backdropUrl,
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
    title?: string | null;
    subtitle?: string | null;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.watchlistRepository.put(client, {
      profileId: params.profileId,
      identity: params.identity,
      sourceEventId: params.eventId,
      addedAt: params.occurredAt,
      title: params.title,
      subtitle: params.subtitle,
      posterUrl: params.posterUrl,
      backdropUrl: params.backdropUrl,
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
    title?: string | null;
    subtitle?: string | null;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.ratingsRepository.put(client, {
      profileId: params.profileId,
      identity: params.identity,
      sourceEventId: params.eventId,
      ratedAt: params.occurredAt,
      rating: params.rating,
      title: params.title,
      subtitle: params.subtitle,
      posterUrl: params.posterUrl,
      backdropUrl: params.backdropUrl,
      payload: params.payload,
    });
  }

  async removeRating(client: DbClient, params: { profileId: string; mediaKey: string }): Promise<void> {
    await this.ratingsRepository.delete(client, params.profileId, params.mediaKey);
  }

  async dismissContinueWatching(client: DbClient, params: { profileId: string; projectionId: string }): Promise<void> {
    await this.continueWatchingRepository.dismissById(client, params.profileId, params.projectionId);
  }
}
