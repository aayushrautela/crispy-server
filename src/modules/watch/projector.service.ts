import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { extractNextEpisodeToAir } from '../metadata/providers/tmdb-episode-helpers.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
import { ProviderMetadataService } from '../metadata/provider-metadata.service.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { deriveProgressPercent } from './heartbeat-policy.js';
import { parseMediaKey, parentMediaTypeForIdentity, showTmdbIdForIdentity, type MediaIdentity } from './media-key.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { MediaProgressRepository } from './media-progress.repo.js';
import { RatingsRepository } from './ratings.repo.js';
import { TrackedSeriesRepository } from './tracked-series.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';
import type { WatchMediaProjection } from './watch.types.js';

type TrackedMediaIdentity = MediaIdentity & {
  mediaType: 'show' | 'anime';
  provider: NonNullable<MediaIdentity['provider']>;
  providerId: NonNullable<MediaIdentity['providerId']>;
};

export class WatchProjectorService {
  constructor(
    private readonly mediaProgressRepository = new MediaProgressRepository(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
    private readonly trackedSeriesRepository = new TrackedSeriesRepository(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
    private readonly metadataViewService = new MetadataViewService(),
  ) {}

  async buildProjection(client: DbClient, identity: MediaIdentity): Promise<WatchMediaProjection> {
    const media = await this.metadataViewService.buildMetadataCardView(client, identity);
    return {
      title: media.title,
      subtitle: media.subtitle,
      posterUrl: media.artwork.posterUrl,
      backdropUrl: media.artwork.backdropUrl,
    };
  }

  async applyPlaybackEvent(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    eventType: string;
    occurredAt: string;
    positionSeconds?: number | null;
    durationSeconds?: number | null;
    payload?: Record<string, unknown>;
    projection?: WatchMediaProjection;
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
        projection: params.projection,
      });

    if (status === 'completed') {
      await this.watchHistoryRepository.upsertWatched(client, {
        profileId: params.profileId,
        identity: params.identity,
        watchedAt: params.occurredAt,
        sourceEventId: params.eventId,
        payload: params.payload,
        projection: params.projection,
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
      projection: params.projection,
    });
  }

  async markWatched(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventId: string;
    occurredAt: string;
    payload?: Record<string, unknown>;
    projection?: WatchMediaProjection;
  }): Promise<void> {
    await this.refreshMetadataReferences(client, params.profileId, params.identity, params.eventId, params.occurredAt, params.payload);
    await this.watchHistoryRepository.upsertWatched(client, {
      profileId: params.profileId,
      identity: params.identity,
      watchedAt: params.occurredAt,
      sourceEventId: params.eventId,
      payload: params.payload,
      projection: params.projection,
    });
    await this.continueWatchingRepository.delete(client, params.profileId, params.identity.mediaKey);
    await this.mediaProgressRepository.upsert(client, {
      profileId: params.profileId,
      identity: params.identity,
      eventId: params.eventId,
      occurredAt: params.occurredAt,
      status: 'completed',
      payload: params.payload,
      projection: params.projection,
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
    projection?: WatchMediaProjection;
  }): Promise<void> {
    await this.refreshMetadataReferences(client, params.profileId, params.identity, params.eventId, params.occurredAt, params.payload, 'watchlist');
    await this.watchlistRepository.put(client, {
      profileId: params.profileId,
      identity: params.identity,
      sourceEventId: params.eventId,
      addedAt: params.occurredAt,
      payload: params.payload,
      projection: params.projection,
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
    projection?: WatchMediaProjection;
  }): Promise<void> {
    await this.refreshMetadataReferences(client, params.profileId, params.identity, params.eventId, params.occurredAt, params.payload, 'rating');
    await this.ratingsRepository.put(client, {
      profileId: params.profileId,
      identity: params.identity,
      sourceEventId: params.eventId,
      ratedAt: params.occurredAt,
      rating: params.rating,
      payload: params.payload,
      projection: params.projection,
    });
  }

  async removeRating(client: DbClient, params: { profileId: string; mediaKey: string }): Promise<void> {
    await this.ratingsRepository.delete(client, params.profileId, params.mediaKey);
  }

  async dismissContinueWatching(client: DbClient, params: {
    profileId: string;
    projectionId?: string;
    mediaKey: string;
    eventId: string;
    occurredAt: string;
  }): Promise<void> {
    if (params.projectionId) {
      await this.continueWatchingRepository.dismissById(client, params.profileId, params.projectionId);
    } else {
    await this.continueWatchingRepository.dismissByMediaKey(client, params.profileId, params.mediaKey);
  }
  await this.mediaProgressRepository.dismissContinueWatching(client, params.profileId, params.mediaKey);
    const trackedIdentity = parseTrackedIdentity(params.mediaKey);
    if (trackedIdentity) {
      await this.trackedSeriesRepository.updateMetadataState(client, {
        profileId: params.profileId,
        trackedMediaKey: trackedIdentity.mediaKey,
        metadataRefreshedAt: params.occurredAt,
      });
    }
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
    const trackedIdentity = toTrackedIdentity(identity);
    if (!trackedIdentity) {
      if (identity.mediaType === 'movie' && identity.provider === 'tmdb' && identity.tmdbId) {
        await this.tmdbCacheService.getTitle(client, 'movie', identity.tmdbId);
      }
      return;
    }

    const nextEpisodeAirDate = await resolveTrackedNextEpisodeAirDate(
      client,
      trackedIdentity,
      this.tmdbCacheService,
      this.providerMetadataService,
    );

    await this.trackedSeriesRepository.upsert(client, {
      profileId,
      trackedMediaKey: trackedIdentity.mediaKey,
      trackedMediaType: trackedIdentity.mediaType,
      provider: trackedIdentity.provider,
      providerId: trackedIdentity.providerId,
      showTmdbId: trackedIdentity.showTmdbId,
      reason,
      lastSourceEventId: eventId,
      lastInteractedAt: occurredAt,
      payload,
    });

    await this.trackedSeriesRepository.updateMetadataState(client, {
      profileId,
      trackedMediaKey: trackedIdentity.mediaKey,
      nextEpisodeAirDate,
      metadataRefreshedAt: new Date().toISOString(),
    });
  }
}

function parseTrackedIdentity(mediaKey: string): TrackedMediaIdentity | null {
  const identity = parseMediaKey(mediaKey);
  return toTrackedIdentity(identity);
}

function toTrackedIdentity(identity: MediaIdentity): TrackedMediaIdentity | null {
  if (identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return identity.provider && identity.providerId
      ? {
          ...identity,
          mediaType: identity.mediaType,
          provider: identity.provider,
          providerId: identity.providerId,
        }
      : null;
  }

  if (identity.mediaType === 'season' || identity.mediaType === 'episode') {
    if (!identity.parentProvider || !identity.parentProviderId) {
      return null;
    }

    const mediaType = parentMediaTypeForIdentity(identity);
    if (mediaType !== 'show' && mediaType !== 'anime') {
      return null;
    }

    return {
      contentId: identity.parentContentId ?? null,
      mediaKey: `${mediaType}:${identity.parentProvider}:${identity.parentProviderId}`,
      mediaType,
      provider: identity.parentProvider,
      providerId: identity.parentProviderId,
      parentContentId: null,
      parentProvider: null,
      parentProviderId: null,
      tmdbId: identity.parentProvider === 'tmdb' ? showTmdbIdForIdentity(identity) : null,
      showTmdbId: identity.parentProvider === 'tmdb' ? showTmdbIdForIdentity(identity) : null,
      seasonNumber: null,
      episodeNumber: null,
      absoluteEpisodeNumber: null,
      providerMetadata: identity.providerMetadata,
    };
  }

  return null;
}

async function resolveTrackedNextEpisodeAirDate(
  client: DbClient,
  trackedIdentity: MediaIdentity,
  tmdbCacheService: TmdbCacheService,
  providerMetadataService: ProviderMetadataService,
): Promise<string | null> {
  if (trackedIdentity.provider === 'tmdb') {
    const showTmdbId = showTmdbIdForIdentity(trackedIdentity);
    if (!showTmdbId) {
      return null;
    }

    const title = await tmdbCacheService.getTitle(client, 'tv', showTmdbId);
    return extractNextEpisodeToAir(title)?.airDate ?? null;
  }

  const context = await providerMetadataService.loadIdentityContext(client, trackedIdentity);
  return context?.nextEpisode?.airDate ?? null;
}
