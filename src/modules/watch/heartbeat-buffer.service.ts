import { HttpError } from '../../lib/errors.js';
import { redis } from '../../lib/redis.js';
import { enqueueHeartbeatFlush } from '../../lib/queue.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { HEARTBEAT_POLICY } from './heartbeat-policy.js';
import type { BufferedHeartbeatSnapshot, WatchEventInput } from './watch.types.js';

function bufferKey(profileId: string, mediaKey: string): string {
  return `watch:heartbeat:latest:${profileId}:${mediaKey}`;
}

export class HeartbeatBufferService {
  async bufferHeartbeat(params: {
    profileGroupId: string;
    profileId: string;
    identity: MediaIdentity;
    input: WatchEventInput;
  }): Promise<void> {
    const occurredAt = params.input.occurredAt ?? new Date().toISOString();
    const snapshot: BufferedHeartbeatSnapshot = {
      profileId: params.profileId,
      profileGroupId: params.profileGroupId,
      clientEventId: params.input.clientEventId,
      eventType: params.input.eventType,
      mediaKey: params.identity.mediaKey,
      mediaType: params.identity.mediaType,
      provider: params.identity.provider ?? null,
      providerId: params.identity.providerId ?? null,
      parentProvider: params.identity.parentProvider ?? null,
      parentProviderId: params.identity.parentProviderId ?? null,
      tmdbId: params.identity.tmdbId,
      tvdbId: null,
      kitsuId: null,
      showTmdbId: params.identity.showTmdbId,
      seasonNumber: params.identity.seasonNumber,
      episodeNumber: params.identity.episodeNumber,
      absoluteEpisodeNumber: params.identity.absoluteEpisodeNumber ?? null,
      positionSeconds: params.input.positionSeconds ?? null,
      durationSeconds: params.input.durationSeconds ?? null,
      occurredAt,
      payload: params.input.payload ?? {},
      bufferedAt: new Date().toISOString(),
    };

    await redis.set(bufferKey(params.profileId, params.identity.mediaKey), JSON.stringify(snapshot), 'EX', HEARTBEAT_POLICY.bufferTtlSeconds);
    await enqueueHeartbeatFlush(params.profileId, params.identity.mediaKey);
  }

  async getBufferedHeartbeat(profileId: string, mediaKey: string): Promise<BufferedHeartbeatSnapshot | null> {
    const raw = await redis.get(bufferKey(profileId, mediaKey));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as BufferedHeartbeatSnapshot;
    } catch {
      throw new HttpError(500, 'Buffered heartbeat payload was invalid.');
    }
  }

  async clearBufferedHeartbeat(profileId: string, mediaKey: string): Promise<void> {
    await redis.del(bufferKey(profileId, mediaKey));
  }

  async clearBufferedHeartbeatIfMatching(params: {
    profileId: string;
    mediaKey: string;
    clientEventId: string;
    occurredAt: string;
  }): Promise<boolean> {
    const key = bufferKey(params.profileId, params.mediaKey);
    const result = await redis.eval(
      `
        local raw = redis.call('GET', KEYS[1])
        if not raw then
          return 0
        end
        local decoded = cjson.decode(raw)
        if decoded.clientEventId == ARGV[1] and decoded.occurredAt == ARGV[2] then
          redis.call('DEL', KEYS[1])
          return 1
        end
        return 0
      `,
      1,
      key,
      params.clientEventId,
      params.occurredAt,
    );
    return result === 1;
  }

  async clearAllForProfile(profileId: string): Promise<number> {
    const pattern = `watch:heartbeat:latest:${profileId}:*`;
    let cursor = '0';
    let deleted = 0;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await redis.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }
}
