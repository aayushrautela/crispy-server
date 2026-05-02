import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { HeartbeatBufferService } from './heartbeat-buffer.service.js';
import { isBufferedHeartbeatEvent } from './heartbeat-policy.js';
import { inferMediaIdentity, parseMediaKey } from '../identity/media-key.js';
import { ProjectionRefreshDispatcher } from './projection-refresh-dispatcher.js';
import { IntegrationOutboxService } from '../integrations/changes/integration-outbox.service.js';
import { WatchV2WriteService } from '../watch-v2/watch-v2-write.service.js';
import { decodeWatchV2ContinueWatchingId } from './watch-v2-utils.js';
import { ProfileInputSignalCacheInvalidator } from '../recommendations/profile-input-signal-cache.invalidator.js';
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
    private readonly integrationOutboxService = new IntegrationOutboxService(),
    private readonly profileInputSignalCacheInvalidator = new ProfileInputSignalCacheInvalidator(),
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
    const mediaKey = inferMediaIdentity(input).mediaKey;
    await this.applyMutation(userId, profileId, 'mark_watched', input, async (client, params) => {
      await this.watchV2WriteService.markWatched(client, {
        profileId,
        identity: params.identity,
        occurredAt: params.occurredAt,
      });
    });
    await this.projectionRefreshDispatcher.invalidateCalendar(profileId);
    await this.profileInputSignalCacheInvalidator.invalidate({
      accountId: userId,
      profileId,
      families: ['history'],
      reason: 'watch_history_mutated',
    });
    await this.projectionRefreshDispatcher.refreshMetadata(profileId, mediaKey);
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
    await this.projectionRefreshDispatcher.invalidateCalendar(profileId);
    await this.profileInputSignalCacheInvalidator.invalidate({
      accountId: userId,
      profileId,
      families: ['history'],
      reason: 'watch_history_mutated',
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async setWatchlist(userId: string, profileId: string, input: WatchMutationInput): Promise<WatchIngestResult> {
    const mediaKey = inferMediaIdentity(input).mediaKey;
    await this.applyMutation(userId, profileId, 'watchlist_put', input, async (client, params) => {
      await this.watchV2WriteService.setWatchlist(client, {
        profileId,
        identity: params.identity,
        occurredAt: params.occurredAt,
      });
    });
    await this.projectionRefreshDispatcher.invalidateCalendar(profileId);
    await this.profileInputSignalCacheInvalidator.invalidate({
      accountId: userId,
      profileId,
      families: ['watchlist'],
      reason: 'watchlist_mutated',
    });
    await this.projectionRefreshDispatcher.refreshMetadata(profileId, mediaKey);
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
    await this.projectionRefreshDispatcher.invalidateCalendar(profileId);
    await this.profileInputSignalCacheInvalidator.invalidate({
      accountId: userId,
      profileId,
      families: ['watchlist'],
      reason: 'watchlist_mutated',
    });
    return { accepted: true, mode: 'synchronous' };
  }

  async setRating(userId: string, profileId: string, input: WatchMutationInput): Promise<WatchIngestResult> {
    if (!input.rating || input.rating < 1 || input.rating > 10) {
      throw new HttpError(400, 'Rating must be between 1 and 10.');
    }
    const mediaKey = inferMediaIdentity(input).mediaKey;
    await this.applyMutation(userId, profileId, 'rating_put', input, async (client, params) => {
      await this.watchV2WriteService.setRating(client, {
        profileId,
        identity: params.identity,
        rating: input.rating as number,
        occurredAt: params.occurredAt,
      });
    });
    await this.projectionRefreshDispatcher.invalidateCalendar(profileId);
    await this.profileInputSignalCacheInvalidator.invalidate({
      accountId: userId,
      profileId,
      families: ['ratings'],
      reason: 'rating_mutated',
    });
    await this.projectionRefreshDispatcher.refreshMetadata(profileId, mediaKey);
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
    await this.projectionRefreshDispatcher.invalidateCalendar(profileId);
    await this.profileInputSignalCacheInvalidator.invalidate({
      accountId: userId,
      profileId,
      families: ['ratings'],
      reason: 'rating_mutated',
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
      await this.appendWatchProgressOutboxEvent(client, {
        accountId: userId,
        profileId,
        identity,
        eventType: 'continue_watching_dismiss',
        occurredAt,
      });
    });
    await this.profileInputSignalCacheInvalidator.invalidate({
      accountId: userId,
      profileId,
      families: ['continueWatching'],
      reason: 'playback_progress_mutated',
    });
    return { accepted: true, mode: 'synchronous' };
  }

  private async ingestPlaybackEventSynchronously(userId: string, profileId: string, input: WatchEventInput): Promise<WatchIngestResult> {
    const identity = inferMediaIdentity(input);
    await withTransaction(async (client) => {
      const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, userId);
      await this.watchV2WriteService.applyPlaybackEvent(client, {
        profileId,
        identity,
        eventType: input.eventType,
        occurredAt: normalizeWatchOccurredAt(input.occurredAt),
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
      });
      await this.appendWatchProgressOutboxEvent(client, {
        accountId: userId,
        profileId,
        profileGroupId: profile.profileGroupId,
        identity,
        eventType: input.eventType,
        occurredAt: normalizeWatchOccurredAt(input.occurredAt),
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
      });
    });
    if (identity.mediaType === 'show' || identity.mediaType === 'season' || identity.mediaType === 'episode') {
      await this.projectionRefreshDispatcher.invalidateCalendar(profileId);
      await this.projectionRefreshDispatcher.refreshMetadata(profileId, identity.mediaKey);
    }
    await this.profileInputSignalCacheInvalidator.invalidate({
      accountId: userId,
      profileId,
      families: ['continueWatching'],
      reason: 'playback_progress_mutated',
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
      const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, userId);
      const occurredAt = normalizeWatchOccurredAt(input.occurredAt);
      const identity = inferMediaIdentity(input);

      await apply(client, {
        profileId,
        identity,
        occurredAt,
        rating: typeof input.rating === 'number' ? input.rating : undefined,
        payload: input.payload,
      });
      await this.appendWatchHistoryOutboxEvent(client, {
        accountId: userId,
        profileId,
        profileGroupId: profile.profileGroupId,
        identity,
        eventType: _eventType,
        occurredAt,
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
      const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const identity = parseMediaKey(mediaKey);
      const occurredAt = new Date().toISOString();
      await apply(client, identity, occurredAt);
      await this.appendWatchHistoryOutboxEvent(client, {
        accountId: userId,
        profileId,
        profileGroupId: profile.profileGroupId,
        identity,
        eventType,
        occurredAt,
      });
    });
  }

  private async appendWatchHistoryOutboxEvent(
    client: import('../../lib/db.js').DbClient,
    input: {
      accountId: string;
      profileId: string;
      profileGroupId?: string;
      identity: ReturnType<typeof inferMediaIdentity> | ReturnType<typeof parseMediaKey>;
      eventType: string;
      occurredAt: string;
    },
  ): Promise<void> {
    await this.integrationOutboxService.appendChange(client, {
      accountId: input.accountId,
      profileId: input.profileId,
      eventType: 'watch_history.upserted',
      aggregateType: 'watch_history',
      aggregateId: `${input.profileId}:${input.identity.mediaKey}`,
      occurredAt: input.occurredAt,
      payload: this.buildWatchOutboxPayload(input),
      idempotencyKey: `watch_history:${input.profileId}:${input.identity.mediaKey}:${input.eventType}:${input.occurredAt}`,
    });
  }

  private async appendWatchProgressOutboxEvent(
    client: import('../../lib/db.js').DbClient,
    input: {
      accountId: string;
      profileId: string;
      profileGroupId?: string;
      identity: ReturnType<typeof inferMediaIdentity> | ReturnType<typeof parseMediaKey>;
      eventType: string;
      occurredAt: string;
      positionSeconds?: number | null;
      durationSeconds?: number | null;
    },
  ): Promise<void> {
    await this.integrationOutboxService.appendChange(client, {
      accountId: input.accountId,
      profileId: input.profileId,
      eventType: 'watch_progress.updated',
      aggregateType: 'watch_progress',
      aggregateId: `${input.profileId}:${input.identity.mediaKey}`,
      occurredAt: input.occurredAt,
      payload: this.buildWatchOutboxPayload(input),
      idempotencyKey: `watch_progress:${input.profileId}:${input.identity.mediaKey}:${input.eventType}:${input.occurredAt}`,
    });
  }

  private buildWatchOutboxPayload(input: {
    profileId: string;
    profileGroupId?: string;
    identity: ReturnType<typeof inferMediaIdentity> | ReturnType<typeof parseMediaKey>;
    eventType: string;
    occurredAt: string;
    positionSeconds?: number | null;
    durationSeconds?: number | null;
  }): Record<string, unknown> {
    return {
      profileId: input.profileId,
      profileGroupId: input.profileGroupId,
      mediaKey: input.identity.mediaKey,
      mediaType: input.identity.mediaType,
      provider: input.identity.provider,
      providerId: input.identity.providerId,
      parentProvider: input.identity.parentProvider,
      parentProviderId: input.identity.parentProviderId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
    };
  }
}
