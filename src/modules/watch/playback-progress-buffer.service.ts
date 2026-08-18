import { redis } from '../../lib/redis.js';
import { logger } from '../../config/logger.js';
import type { LocalUserWatchService } from '../integrations/local-user-watch.service.js';

const POS_TTL_SECONDS = 90 * 24 * 60 * 60;
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DIRTY_SCAN_PATTERN = 'cw:dirty:*';
const PROCESSING_KEY_PREFIX = 'cw:processing:';

export type BufferedPlaybackProgress = {
  accountId: string;
  profileId: string;
  itemId: string;
  titleItemId: string;
  mediaType: 'movie' | 'show' | 'season' | 'episode';
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressBps: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  eventKind: 'playback_progress' | 'playback_completed';
  lastActivityAt: string;
};

function posKey(accountId: string, profileId: string, itemId: string): string {
  return `cw:pos:${accountId}:${profileId}:${itemId}`;
}

function dirtyKey(accountId: string, profileId: string): string {
  return `cw:dirty:${accountId}:${profileId}`;
}

function processingKey(accountId: string, profileId: string): string {
  return `${PROCESSING_KEY_PREFIX}${accountId}:${profileId}`;
}

/**
 * Write-behind buffer for high-frequency playback-progress heartbeats.
 *
 * The events route writes the latest position into Redis (one key per
 * in-progress item) and returns immediately; a background flusher batches the
 * buffered positions into the relational store on a fixed interval. This keeps
 * the request path free of DB round-trips and collapses many heartbeats into a
 * single write per item per flush window.
 *
 * Crash safety: dirty members are atomically moved to a per-profile
 * `cw:processing:*` set before the flush, and only cleared after a successful
 * write, so a crash mid-flush cannot drop buffered progress. Leftover
 * processing sets are drained on boot.
 */
export class PlaybackProgressBuffer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(
    private readonly watchService: LocalUserWatchService,
    intervalMs: number = DEFAULT_FLUSH_INTERVAL_MS,
  ) {
    this.intervalMs = intervalMs;
  }

  async bufferProgress(input: BufferedPlaybackProgress): Promise<void> {
    const key = posKey(input.accountId, input.profileId, input.itemId);
    await redis.set(key, JSON.stringify(input), 'EX', POS_TTL_SECONDS);
    await redis.sadd(dirtyKey(input.accountId, input.profileId), input.itemId);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch((err) => logger.error({ err }, 'playback progress flush failed'));
    }, this.intervalMs);
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async flushPendingOnBoot(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${PROCESSING_KEY_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        if (!key.startsWith(PROCESSING_KEY_PREFIX)) continue;
        const parts = key.split(':');
        if (parts.length < 4) continue;
        const accountId = parts[2];
        const profileId = parts[3];
        if (!accountId || !profileId) continue;
        await this.flushProfile(accountId, profileId, processingKey(accountId, profileId));
      }
    } while (cursor !== '0');
  }

  async flush(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', DIRTY_SCAN_PATTERN, 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        if (!key.startsWith('cw:dirty:')) continue;
        const parts = key.split(':');
        if (parts.length < 4) continue;
        const accountId = parts[2];
        const profileId = parts[3];
        if (!accountId || !profileId) continue;
        await this.flushProfile(accountId, profileId, dirtyKey(accountId, profileId));
      }
    } while (cursor !== '0');
  }

  private async flushProfile(accountId: string, profileId: string, sourceKey: string): Promise<void> {
    const pKey = processingKey(accountId, profileId);
    const members = await redis.smembers(sourceKey);
    if (members.length === 0) return;

    for (const member of members) {
      await redis.smove(sourceKey, pKey, member);
    }

    try {
      for (const itemId of members) {
        const raw = await redis.get(posKey(accountId, profileId, itemId));
        if (!raw) continue;
        const data = JSON.parse(raw) as BufferedPlaybackProgress;
        await this.watchService.recordPlaybackState({
          accountId: data.accountId,
          profileId: data.profileId,
          itemId: data.itemId,
          titleItemId: data.titleItemId,
          mediaType: data.mediaType,
          positionSeconds: data.positionSeconds,
          durationSeconds: data.durationSeconds,
          eventKind: data.eventKind,
          occurredAt: data.lastActivityAt,
          clientEventId: null,
          seasonNumber: data.seasonNumber,
          episodeNumber: data.episodeNumber,
        });
      }
      await redis.del(pKey);
    } catch (err) {
      logger.error({ err, accountId, profileId }, 'failed to flush buffered playback progress');
    }
  }
}

let singleton: PlaybackProgressBuffer | null = null;

export function getPlaybackProgressBuffer(watchService?: LocalUserWatchService): PlaybackProgressBuffer {
  if (!singleton) {
    if (!watchService) {
      throw new Error('PlaybackProgressBuffer accessed before initialization');
    }
    singleton = new PlaybackProgressBuffer(watchService);
  }
  return singleton;
}
