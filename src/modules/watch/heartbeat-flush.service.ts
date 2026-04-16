import { withTransaction } from '../../lib/db.js';
import { enqueueHeartbeatFlush } from '../../lib/queue.js';
import type { PersistedProgressSnapshot } from './heartbeat-policy.js';
import { evaluateHeartbeatSnapshot, HEARTBEAT_POLICY } from './heartbeat-policy.js';
import { HeartbeatBufferService } from './heartbeat-buffer.service.js';
import { ensureSupportedMediaType, inferMediaIdentity } from '../identity/media-key.js';
import { ProjectionRefreshDispatcher } from './projection-refresh-dispatcher.js';
import { RecommendationGenerationDispatcher } from '../recommendations/recommendation-generation-dispatcher.js';
import { WatchV2WriteService } from '../watch-v2/watch-v2-write.service.js';
import { normalizeWatchOccurredAt } from './watch.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { resolveWatchV2Lookup } from './watch-v2-utils.js';

export class HeartbeatFlushService {
  constructor(
    private readonly heartbeatBufferService = new HeartbeatBufferService(),
    private readonly watchV2WriteService = new WatchV2WriteService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly projectionRefreshDispatcher = new ProjectionRefreshDispatcher(),
    private readonly recommendationGenerationDispatcher = new RecommendationGenerationDispatcher(),
  ) {}

  async flush(profileId: string, mediaKey: string): Promise<{ action: 'persisted' | 'deferred' | 'cleared' | 'missing'; reason: string }> {
    const snapshot = await this.heartbeatBufferService.getBufferedHeartbeat(profileId, mediaKey);
    if (!snapshot) {
      return { action: 'missing', reason: 'buffer_empty' };
    }

    const normalizedOccurredAt = normalizeWatchOccurredAt(snapshot.occurredAt);

    const outcome = await withTransaction(async (client) => {
      const identity = inferMediaIdentity({
        mediaKey: snapshot.mediaKey,
        mediaType: ensureSupportedMediaType(snapshot.mediaType),
        provider: snapshot.provider,
        providerId: snapshot.providerId,
        parentProvider: snapshot.parentProvider,
        parentProviderId: snapshot.parentProviderId,
        tmdbId: snapshot.tmdbId,
        tvdbId: snapshot.tvdbId,
        kitsuId: snapshot.kitsuId,
        showTmdbId: snapshot.showTmdbId,
        seasonNumber: snapshot.seasonNumber,
        episodeNumber: snapshot.episodeNumber,
        absoluteEpisodeNumber: snapshot.absoluteEpisodeNumber,
      });
      const current = await this.getPersistedProgressSnapshot(client, profileId, identity);
      const decision = evaluateHeartbeatSnapshot(snapshot, current);

      if (decision.action === 'clear_buffer') {
        return { action: 'cleared' as const, reason: decision.reason };
      }

      if (decision.action === 'keep_buffer') {
        return { action: 'deferred' as const, reason: decision.reason };
      }

      await this.watchV2WriteService.applyPlaybackEvent(client, {
        profileId,
        identity,
        eventType: 'playback_progress_snapshot',
        occurredAt: normalizedOccurredAt,
        positionSeconds: snapshot.positionSeconds,
        durationSeconds: snapshot.durationSeconds,
      });

      return { action: 'persisted' as const, reason: decision.reason };
    });

    if (outcome.action === 'cleared' || outcome.action === 'persisted') {
      await this.heartbeatBufferService.clearBufferedHeartbeatIfMatching({
        profileId,
        mediaKey,
        clientEventId: snapshot.clientEventId,
        occurredAt: snapshot.occurredAt,
      });
    }

    if (outcome.action === 'deferred') {
      await enqueueHeartbeatFlush(profileId, mediaKey, HEARTBEAT_POLICY.recheckDelayMs);
    }

    if (outcome.action === 'persisted') {
      const identity = inferMediaIdentity({ mediaKey, mediaType: ensureSupportedMediaType(snapshot.mediaType) });
      if (identity.mediaType === 'show' || identity.mediaType === 'anime' || identity.mediaType === 'season' || identity.mediaType === 'episode') {
        await this.projectionRefreshDispatcher.invalidateCalendar(profileId);
        await this.projectionRefreshDispatcher.refreshMetadata(profileId, mediaKey);
      }
      await this.recommendationGenerationDispatcher.scheduleProfileGeneration(profileId, undefined, 'heartbeat_flush');
    }

    return outcome;
  }

  private async getPersistedProgressSnapshot(
    client: import('../../lib/db.js').DbClient,
    profileId: string,
    identity: ReturnType<typeof inferMediaIdentity>,
  ): Promise<PersistedProgressSnapshot | null> {
    const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, identity);
    if (identity.mediaType !== 'movie' && identity.mediaType !== 'episode') {
      return null;
    }

    const result = await client.query(
      `
        SELECT
          position_seconds,
          duration_seconds,
          progress_percent,
          playback_status,
          last_activity_at
        FROM profile_playable_state
        WHERE profile_id = $1::uuid
          AND content_id = $2::uuid
      `,
      [profileId, lookup.contentId],
    );
    const row = result.rows[0] ?? null;
    if (!row) {
      return null;
    }

    return {
      positionSeconds: Number(row.position_seconds ?? 0),
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      progressPercent: Number(row.progress_percent ?? 0),
      status: typeof row.playback_status === 'string' ? row.playback_status : undefined,
      lastPlayedAt: typeof row.last_activity_at === 'string'
        ? row.last_activity_at
        : row.last_activity_at instanceof Date
          ? row.last_activity_at.toISOString()
          : undefined,
    };
  }
}
