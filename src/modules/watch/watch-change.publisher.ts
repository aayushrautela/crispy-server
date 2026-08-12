import { redis } from '../../lib/redis.js';

const CHANNEL_PREFIX = 'cw:';
const DIRTY_KEY_PREFIX = 'cw-dirty:';
const DEBOUNCE_SECONDS = 5;

export type WatchChangeKind = 'continue_watching';

export interface WatchChangedMessage {
  profileId: string;
  kind: WatchChangeKind;
  at_ms: number;
}

/**
 * Publishes a lightweight invalidation (never the payload) after a watch-state
 * write. Clients refetch the continue-watching page on receipt. Progress ticks
 * are debounced per profile so a long playback session cannot flood Redis;
 * `playback_completed` and dismiss bypass the debounce because they must reach
 * other devices immediately.
 */
export async function publishWatchChanged(
  accountId: string,
  profileId: string,
  kind: WatchChangeKind,
  options: { force?: boolean; atMs?: number } = {},
): Promise<void> {
  const dirtyKey = `${DIRTY_KEY_PREFIX}${accountId}:${profileId}`;

  if (!options.force) {
    const acquired = await redis.set(dirtyKey, '1', 'EX', DEBOUNCE_SECONDS, 'NX');
    if (acquired == null) {
      return;
    }
  }

  const message: WatchChangedMessage = {
    profileId,
    kind,
    at_ms: options.atMs ?? Date.now(),
  };

  await redis.publish(`${CHANNEL_PREFIX}${accountId}`, JSON.stringify(message));

  if (options.force) {
    await redis.set(dirtyKey, '1', 'EX', DEBOUNCE_SECONDS).catch(() => {});
  }
}
