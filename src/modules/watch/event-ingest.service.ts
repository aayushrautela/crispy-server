import { randomUUID } from 'node:crypto';
import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { HeartbeatBufferService } from './heartbeat-buffer.service.js';
import { isBufferedHeartbeatEvent } from './heartbeat-policy.js';
import { inferMediaIdentity, parseMediaKey } from './media-key.js';
import { ProjectionRefreshDispatcher } from './projection-refresh-dispatcher.js';
import { WatchEventsRepository } from './watch-events.repo.js';
import { WatchProjectorService } from './projector.service.js';
import { sanitizeWatchEventInput, type WatchEventInput, type WatchIngestResult, type WatchMutationInput } from './watch.types.js';

export class WatchEventIngestService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly watchEventsRepository = new WatchEventsRepository(),
    private readonly projector = new WatchProjectorService(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly heartbeatBufferService = new HeartbeatBufferService(),
    private readonly projectionRefreshDispatcher = new ProjectionRefreshDispatcher(),
  ) {}

  async ingestPlaybackEvent(userId: string, profileId: string, input: WatchEventInput): Promise<WatchIngestResult> {
    const normalizedInput = sanitizeWatchEventInput(input);
    if (!normalizedInput.clientEventId) {
      throw new HttpError(400, 'clientEventId is required.');
    }
    if (!normalizedInput.eventType) {
      throw new HttpError(400, 'eventType is required.');
    }
    if (!normalizedInput.mediaType) {
      throw new HttpError(400, 'mediaType is required.');
    }

    if (isBufferedHeartbeatEvent(normalizedInput.eventType)) {
      return this.bufferPlaybackHeartbeat(userId, profileId, normalizedInput);
    }

    return this.ingestPlaybackEventSynchronously(userId, profileId, normalizedInput);
  }

  async markWatched(userId: string, profileId: string, input: WatchMutationInput): Promise<WatchIngestResult> {
    await this.applyMutation(userId, profileId, 'mark_watched', input, async (client, params) => {
      await this.projector.markWatched(client, params);
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: inferMediaIdentity(input).mediaKey,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async unmarkWatched(userId: string, profileId: string, input: WatchMutationInput): Promise<WatchIngestResult> {
    await this.applyMutation(userId, profileId, 'unmark_watched', input, async (client, params) => {
      await this.projector.unmarkWatched(client, { profileId, mediaKey: params.identity.mediaKey });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: inferMediaIdentity(input).mediaKey,
      refreshMetadata: false,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async setWatchlist(userId: string, profileId: string, input: WatchMutationInput): Promise<WatchIngestResult> {
    await this.applyMutation(userId, profileId, 'watchlist_put', input, async (client, params) => {
      await this.projector.setWatchlist(client, params);
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: inferMediaIdentity(input).mediaKey,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async removeWatchlist(userId: string, profileId: string, mediaKey: string): Promise<WatchIngestResult> {
    await this.applyMutationByMediaKey(userId, profileId, 'watchlist_remove', mediaKey, async (client) => {
      await this.projector.removeWatchlist(client, { profileId, mediaKey });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey,
      refreshMetadata: false,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async setRating(userId: string, profileId: string, input: WatchMutationInput): Promise<WatchIngestResult> {
    if (!input.rating || input.rating < 1 || input.rating > 10) {
      throw new HttpError(400, 'Rating must be between 1 and 10.');
    }
    await this.applyMutation(userId, profileId, 'rating_put', input, async (client, params) => {
      await this.projector.setRating(client, {
        ...params,
        rating: input.rating as number,
      });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: inferMediaIdentity(input).mediaKey,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async removeRating(userId: string, profileId: string, mediaKey: string): Promise<WatchIngestResult> {
    await this.applyMutationByMediaKey(userId, profileId, 'rating_remove', mediaKey, async (client) => {
      await this.projector.removeRating(client, { profileId, mediaKey });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey,
      refreshMetadata: false,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async dismissContinueWatching(userId: string, profileId: string, projectionId: string): Promise<WatchIngestResult> {
    let mediaKey: string | null = null;
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const continueWatching = await this.continueWatchingRepository.findById(client, profileId, projectionId);
      if (!continueWatching) {
        throw new HttpError(404, 'Continue watching item not found.');
      }

      mediaKey = String(continueWatching.media_key);
      const identity = parseMediaKey(mediaKey);
      const occurredAt = new Date().toISOString();
      const event = await this.watchEventsRepository.insert(client, {
        profileGroupId: profile.profileGroupId,
        profileId,
        input: {
          clientEventId: randomUUID(),
          eventType: 'continue_watching_dismissed',
          mediaKey: identity.mediaKey,
          mediaType: identity.mediaType,
          tmdbId: identity.tmdbId,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
          occurredAt,
          payload: {},
        },
        identity,
      });

      await this.projector.dismissContinueWatching(client, {
        profileId,
        projectionId,
        mediaKey: identity.mediaKey,
        eventId: event.id,
        occurredAt,
      });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: mediaKey ?? undefined,
      refreshMetadata: false,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  private async ingestPlaybackEventSynchronously(userId: string, profileId: string, input: WatchEventInput): Promise<WatchIngestResult> {
    const identity = inferMediaIdentity(input);
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const event = await this.watchEventsRepository.insert(client, {
        profileGroupId: profile.profileGroupId,
        profileId,
        input,
        identity,
      });
      await this.projector.applyPlaybackEvent(client, {
        profileId,
        identity,
        eventId: event.id,
        eventType: input.eventType,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        payload: input.payload,
      });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: identity.mediaKey,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  private async bufferPlaybackHeartbeat(userId: string, profileId: string, input: WatchEventInput): Promise<WatchIngestResult> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const identity = inferMediaIdentity(input);
      await this.heartbeatBufferService.bufferHeartbeat({
        profileGroupId: profile.profileGroupId,
        profileId,
        identity,
        input,
      });
    });
    return { accepted: true, mode: 'buffered' };
  }

  private async applyMutation(
    userId: string,
    profileId: string,
    eventType: string,
    input: WatchMutationInput,
    apply: (client: import('../../lib/db.js').DbClient, params: {
      profileId: string;
      identity: ReturnType<typeof inferMediaIdentity>;
      eventId: string;
      occurredAt: string;
      rating?: number;
      payload?: Record<string, unknown>;
    }) => Promise<void>,
  ): Promise<void> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const occurredAt = input.occurredAt ?? new Date().toISOString();
      const identity = inferMediaIdentity(input);
      const event = await this.watchEventsRepository.insert(client, {
        profileGroupId: profile.profileGroupId,
        profileId,
        input: {
          clientEventId: randomUUID(),
          eventType,
          mediaKey: identity.mediaKey,
          mediaType: identity.mediaType,
          tmdbId: identity.tmdbId,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
          rating: input.rating,
          occurredAt,
          payload: input.payload,
        },
        identity,
      });

      await apply(client, {
        profileId,
        identity,
        eventId: event.id,
        occurredAt,
        rating: typeof input.rating === 'number' ? input.rating : undefined,
        payload: input.payload,
      });
    });
  }

  private async applyMutationByMediaKey(
    userId: string,
    profileId: string,
    eventType: string,
    mediaKey: string,
    apply: (client: import('../../lib/db.js').DbClient) => Promise<void>,
  ): Promise<void> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const identity = parseMediaKey(mediaKey);
      await this.watchEventsRepository.insert(client, {
        profileGroupId: profile.profileGroupId,
        profileId,
        input: {
          clientEventId: randomUUID(),
          eventType,
          mediaKey: identity.mediaKey,
          mediaType: identity.mediaType,
          tmdbId: identity.tmdbId,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
          occurredAt: new Date().toISOString(),
          payload: {},
        },
        identity,
      });

      await apply(client);
    });
  }
}
