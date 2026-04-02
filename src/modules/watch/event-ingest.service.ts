import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { HeartbeatBufferService } from './heartbeat-buffer.service.js';
import { isBufferedHeartbeatEvent } from './heartbeat-policy.js';
import { inferMediaIdentity, parseMediaKey } from '../identity/media-key.js';
import { ProjectionRefreshDispatcher } from './projection-refresh-dispatcher.js';
import { WatchV2WriteService } from '../watch-v2/watch-v2-write.service.js';
import { decodeWatchV2ContinueWatchingId } from './watch-v2-utils.js';
import {
  normalizeWatchOccurredAt,
  sanitizeWatchEventInput,
  type WatchEventInput,
  type WatchIngestResult,
  type WatchMutationInput,
} from './watch.types.js';

export class WatchEventIngestService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly watchV2WriteService = new WatchV2WriteService(),
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
      await this.watchV2WriteService.markWatched(client, {
        profileId,
        identity: params.identity,
        occurredAt: params.occurredAt,
      });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: inferMediaIdentity(input).mediaKey,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async unmarkWatched(userId: string, profileId: string, input: WatchMutationInput): Promise<WatchIngestResult> {
    await this.applyMutation(userId, profileId, 'unmark_watched', input, async (client, params) => {
      await this.watchV2WriteService.unmarkWatched(client, {
        profileId,
        identity: params.identity,
        occurredAt: params.occurredAt,
      });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: inferMediaIdentity(input).mediaKey,
      refreshMetadata: false,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async setWatchlist(userId: string, profileId: string, input: WatchMutationInput): Promise<WatchIngestResult> {
    await this.applyMutation(userId, profileId, 'watchlist_put', input, async (client, params) => {
      await this.watchV2WriteService.setWatchlist(client, {
        profileId,
        identity: params.identity,
        occurredAt: params.occurredAt,
      });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: inferMediaIdentity(input).mediaKey,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async removeWatchlist(userId: string, profileId: string, mediaKey: string): Promise<WatchIngestResult> {
    await this.applyMutationByMediaKey(userId, profileId, 'watchlist_remove', mediaKey, async (client, identity, occurredAt) => {
      await this.watchV2WriteService.removeWatchlist(client, {
        profileId,
        identity,
        occurredAt,
      });
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
      await this.watchV2WriteService.setRating(client, {
        profileId,
        identity: params.identity,
        rating: input.rating as number,
        occurredAt: params.occurredAt,
      });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: inferMediaIdentity(input).mediaKey,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async removeRating(userId: string, profileId: string, mediaKey: string): Promise<WatchIngestResult> {
    await this.applyMutationByMediaKey(userId, profileId, 'rating_remove', mediaKey, async (client, identity, occurredAt) => {
      await this.watchV2WriteService.removeRating(client, {
        profileId,
        identity,
        occurredAt,
      });
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
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const watchV2TitleContentId = decodeWatchV2ContinueWatchingId(projectionId);
      if (!watchV2TitleContentId) {
        throw new HttpError(400, 'Continue watching dismissal requires a cw2 id.');
      }

      const result = await client.query(
        `
          SELECT active_media_key, title_media_key
          FROM profile_title_projection
          WHERE profile_id = $1::uuid
            AND title_content_id = $2::uuid
            AND has_in_progress = true
            AND dismissed_at IS NULL
        `,
        [profileId, watchV2TitleContentId],
      );
      const row = result.rows[0] ?? null;
      if (!row) {
        throw new HttpError(404, 'Continue watching item not found.');
      }
      mediaKey = typeof row.active_media_key === 'string' ? row.active_media_key : String(row.title_media_key);

      if (!mediaKey) {
        throw new HttpError(404, 'Continue watching item not found.');
      }
      const identity = parseMediaKey(mediaKey);
      const occurredAt = new Date().toISOString();
      await this.watchV2WriteService.dismissContinueWatching(client, {
        profileId,
        identity,
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
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);
      await this.watchV2WriteService.applyPlaybackEvent(client, {
        profileId,
        identity,
        eventType: input.eventType,
        occurredAt: normalizeWatchOccurredAt(input.occurredAt),
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
      });
    });
    await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, {
      mediaKey: identity.mediaKey,
    });
    return { accepted: true, mode: 'synchronous' };
  }

  private async bufferPlaybackHeartbeat(userId: string, profileId: string, input: WatchEventInput): Promise<WatchIngestResult> {
    await withTransaction(async (client) => {
      const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, userId);
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
    _eventType: string,
    input: WatchMutationInput,
      apply: (client: import('../../lib/db.js').DbClient, params: {
        profileId: string;
        identity: ReturnType<typeof inferMediaIdentity>;
        occurredAt: string;
        rating?: number;
        payload?: Record<string, unknown>;
      }) => Promise<void>,
  ): Promise<void> {
    await withTransaction(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);
      const occurredAt = normalizeWatchOccurredAt(input.occurredAt);
      const identity = inferMediaIdentity(input);

      await apply(client, {
        profileId,
        identity,
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
    apply: (
      client: import('../../lib/db.js').DbClient,
      identity: ReturnType<typeof parseMediaKey>,
      occurredAt: string,
    ) => Promise<void>,
  ): Promise<void> {
    await withTransaction(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const identity = parseMediaKey(mediaKey);
      const occurredAt = new Date().toISOString();
      await apply(client, identity, occurredAt);
    });
  }
}
