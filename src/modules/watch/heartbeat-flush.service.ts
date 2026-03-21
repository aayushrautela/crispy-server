import { randomUUID } from 'node:crypto';
import { withTransaction } from '../../lib/db.js';
import { enqueueHeartbeatFlush } from '../../lib/queue.js';
import { evaluateHeartbeatSnapshot, HEARTBEAT_POLICY } from './heartbeat-policy.js';
import { HeartbeatBufferService } from './heartbeat-buffer.service.js';
import { MediaProgressRepository } from './media-progress.repo.js';
import { WatchEventsRepository } from './watch-events.repo.js';
import { WatchProjectorService } from './projector.service.js';

export class HeartbeatFlushService {
  constructor(
    private readonly heartbeatBufferService = new HeartbeatBufferService(),
    private readonly mediaProgressRepository = new MediaProgressRepository(),
    private readonly watchEventsRepository = new WatchEventsRepository(),
    private readonly projector = new WatchProjectorService(),
  ) {}

  async flush(profileId: string, mediaKey: string): Promise<{ action: 'persisted' | 'deferred' | 'cleared' | 'missing'; reason: string }> {
    const snapshot = await this.heartbeatBufferService.getBufferedHeartbeat(profileId, mediaKey);
    if (!snapshot) {
      return { action: 'missing', reason: 'buffer_empty' };
    }

    const outcome = await withTransaction(async (client) => {
      const current = await this.mediaProgressRepository.getByMediaKey(client, profileId, mediaKey);
      const decision = evaluateHeartbeatSnapshot(snapshot, current);

      if (decision.action === 'clear_buffer') {
        return { action: 'cleared' as const, reason: decision.reason };
      }

      if (decision.action === 'keep_buffer') {
        return { action: 'deferred' as const, reason: decision.reason };
      }

      const event = await this.watchEventsRepository.insert(client, {
        householdId: snapshot.householdId,
        profileId,
        input: {
          clientEventId: `heartbeat-flush:${profileId}:${mediaKey}:${snapshot.occurredAt}:${randomUUID()}`,
          eventType: 'playback_progress_snapshot',
          mediaKey: snapshot.mediaKey,
          mediaType: snapshot.mediaType,
          tmdbId: snapshot.tmdbId,
          showTmdbId: snapshot.showTmdbId,
          seasonNumber: snapshot.seasonNumber,
          episodeNumber: snapshot.episodeNumber,
          title: snapshot.title,
          subtitle: snapshot.subtitle,
          posterUrl: snapshot.posterUrl,
          backdropUrl: snapshot.backdropUrl,
          positionSeconds: snapshot.positionSeconds,
          durationSeconds: snapshot.durationSeconds,
          occurredAt: snapshot.occurredAt,
          payload: {
            ...snapshot.payload,
            ingest_mode: 'buffered_flush',
          },
        },
        identity: {
          mediaKey: snapshot.mediaKey,
          mediaType: snapshot.mediaType,
          tmdbId: snapshot.tmdbId,
          showTmdbId: snapshot.showTmdbId,
          seasonNumber: snapshot.seasonNumber,
          episodeNumber: snapshot.episodeNumber,
        },
      });

      await this.projector.applyPlaybackEvent(client, {
        profileId,
        identity: {
          mediaKey: snapshot.mediaKey,
          mediaType: snapshot.mediaType,
          tmdbId: snapshot.tmdbId,
          showTmdbId: snapshot.showTmdbId,
          seasonNumber: snapshot.seasonNumber,
          episodeNumber: snapshot.episodeNumber,
        },
        eventId: event.id,
        eventType: 'playback_progress_snapshot',
        occurredAt: snapshot.occurredAt,
        title: snapshot.title,
        subtitle: snapshot.subtitle,
        posterUrl: snapshot.posterUrl,
        backdropUrl: snapshot.backdropUrl,
        positionSeconds: snapshot.positionSeconds,
        durationSeconds: snapshot.durationSeconds,
        payload: {
          ...snapshot.payload,
          ingest_mode: 'buffered_flush',
        },
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

    return outcome;
  }
}
