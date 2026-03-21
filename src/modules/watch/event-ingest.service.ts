import { randomUUID } from 'node:crypto';
import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { inferMediaIdentity } from './media-key.js';
import { WatchEventsRepository } from './watch-events.repo.js';
import { WatchProjectorService } from './projector.service.js';
import type { WatchEventInput, WatchMutationInput } from './watch.types.js';

export class WatchEventIngestService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly watchEventsRepository = new WatchEventsRepository(),
    private readonly projector = new WatchProjectorService(),
  ) {}

  async ingestPlaybackEvent(userId: string, profileId: string, input: WatchEventInput): Promise<{ accepted: true }> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const identity = inferMediaIdentity(input);
      const event = await this.watchEventsRepository.insert(client, {
        householdId: profile.householdId,
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
        title: input.title,
        subtitle: input.subtitle,
        posterUrl: input.posterUrl,
        backdropUrl: input.backdropUrl,
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        payload: input.payload,
      });
    });
    return { accepted: true };
  }

  async markWatched(userId: string, profileId: string, input: WatchMutationInput): Promise<{ accepted: true }> {
    await this.applyMutation(userId, profileId, 'mark_watched', input, async (client, params) => {
      await this.projector.markWatched(client, params);
    });
    return { accepted: true };
  }

  async unmarkWatched(userId: string, profileId: string, input: WatchMutationInput): Promise<{ accepted: true }> {
    await this.applyMutation(userId, profileId, 'unmark_watched', input, async (client, params) => {
      await this.projector.unmarkWatched(client, { profileId, mediaKey: params.identity.mediaKey });
    });
    return { accepted: true };
  }

  async setWatchlist(userId: string, profileId: string, input: WatchMutationInput): Promise<{ accepted: true }> {
    await this.applyMutation(userId, profileId, 'watchlist_put', input, async (client, params) => {
      await this.projector.setWatchlist(client, params);
    });
    return { accepted: true };
  }

  async removeWatchlist(userId: string, profileId: string, mediaKey: string): Promise<{ accepted: true }> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      await this.projector.removeWatchlist(client, { profileId, mediaKey });
    });
    return { accepted: true };
  }

  async setRating(userId: string, profileId: string, input: WatchMutationInput): Promise<{ accepted: true }> {
    if (!input.rating || input.rating < 1 || input.rating > 10) {
      throw new HttpError(400, 'Rating must be between 1 and 10.');
    }
    await this.applyMutation(userId, profileId, 'rating_put', input, async (client, params) => {
      await this.projector.setRating(client, {
        ...params,
        rating: input.rating as number,
      });
    });
    return { accepted: true };
  }

  async removeRating(userId: string, profileId: string, mediaKey: string): Promise<{ accepted: true }> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      await this.projector.removeRating(client, { profileId, mediaKey });
    });
    return { accepted: true };
  }

  async dismissContinueWatching(userId: string, profileId: string, projectionId: string): Promise<{ accepted: true }> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      await this.projector.dismissContinueWatching(client, { profileId, projectionId });
    });
    return { accepted: true };
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
      title?: string | null;
      subtitle?: string | null;
      posterUrl?: string | null;
      backdropUrl?: string | null;
      payload?: Record<string, unknown>;
    }) => Promise<void>,
  ): Promise<void> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      const occurredAt = input.occurredAt ?? new Date().toISOString();
      const identity = inferMediaIdentity(input);
      const event = await this.watchEventsRepository.insert(client, {
        householdId: profile.householdId,
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
          title: input.title,
          subtitle: input.subtitle,
          posterUrl: input.posterUrl,
          backdropUrl: input.backdropUrl,
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
        title: input.title,
        subtitle: input.subtitle,
        posterUrl: input.posterUrl,
        backdropUrl: input.backdropUrl,
        payload: input.payload,
      });
    });
  }
}
