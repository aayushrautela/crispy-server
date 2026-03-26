import { randomUUID } from 'node:crypto';
import { withTransaction } from '../../lib/db.js';
import { enqueueHeartbeatFlush } from '../../lib/queue.js';
import { evaluateHeartbeatSnapshot, HEARTBEAT_POLICY } from './heartbeat-policy.js';
import { HeartbeatBufferService } from './heartbeat-buffer.service.js';
import { ensureSupportedMediaType } from './media-key.js';
import { MediaProgressRepository } from './media-progress.repo.js';
import { ProjectionRefreshDispatcher } from './projection-refresh-dispatcher.js';
import { WatchEventsRepository } from './watch-events.repo.js';
import { WatchProjectorService } from './projector.service.js';
import { normalizeWatchOccurredAt } from './watch.types.js';

export class HeartbeatFlushService {
  constructor(
    private readonly heartbeatBufferService = new HeartbeatBufferService(),
    private readonly mediaProgressRepository = new MediaProgressRepository(),
    private readonly watchEventsRepository = new WatchEventsRepository(),
    private readonly projector = new WatchProjectorService(),
    private readonly projectionRefreshDispatcher = new ProjectionRefreshDispatcher(),
  ) {}

  async flush(profileId: string, mediaKey: string): Promise<{ action: 'persisted' | 'deferred' | 'cleared' | 'missing'; reason: string }> {
    const snapshot = await this.heartbeatBufferService.getBufferedHeartbeat(profileId, mediaKey);
    if (!snapshot) {
      return { action: 'missing', reason: 'buffer_empty' };
    }

    const normalizedOccurredAt = normalizeWatchOccurredAt(snapshot.occurredAt);

    const outcome = await withTransaction(async (client) => {
      const current = await this.mediaProgressRepository.getByMediaKey(client, profileId, mediaKey);
      const decision = evaluateHeartbeatSnapshot(snapshot, current);

      if (decision.action === 'clear_buffer') {
        return { action: 'cleared' as const, reason: decision.reason };
      }

      if (decision.action === 'keep_buffer') {
        return { action: 'deferred' as const, reason: decision.reason };
      }

      const identity = {
        mediaKey: snapshot.mediaKey,
        mediaType: ensureSupportedMediaType(snapshot.mediaType),
        tmdbId: snapshot.tmdbId,
        showTmdbId: snapshot.showTmdbId,
        seasonNumber: snapshot.seasonNumber,
        episodeNumber: snapshot.episodeNumber,
      };
      const projection = await this.projector.buildProjection(client, identity);

      const event = await this.watchEventsRepository.insert(client, {
        profileGroupId: snapshot.profileGroupId,
        profileId,
        input: {
          clientEventId: `heartbeat-flush:${profileId}:${mediaKey}:${normalizedOccurredAt}:${randomUUID()}`,
          eventType: 'playback_progress_snapshot',
          mediaKey: snapshot.mediaKey,
          mediaType: snapshot.mediaType,
          tmdbId: snapshot.tmdbId,
          showTmdbId: snapshot.showTmdbId,
          seasonNumber: snapshot.seasonNumber,
          episodeNumber: snapshot.episodeNumber,
          positionSeconds: snapshot.positionSeconds,
          durationSeconds: snapshot.durationSeconds,
          occurredAt: normalizedOccurredAt,
          payload: {
            ...snapshot.payload,
            ingest_mode: 'buffered_flush',
          },
        },
        identity,
        projection,
      });

      await this.projector.applyPlaybackEvent(client, {
        profileId,
        identity,
        eventId: event.id,
        eventType: 'playback_progress_snapshot',
        occurredAt: normalizedOccurredAt,
        positionSeconds: snapshot.positionSeconds,
        durationSeconds: snapshot.durationSeconds,
        payload: {
          ...snapshot.payload,
          ingest_mode: 'buffered_flush',
        },
        projection,
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
      await this.projectionRefreshDispatcher.notifyProfileChanged(profileId, { mediaKey });
    }

    return outcome;
  }
}
