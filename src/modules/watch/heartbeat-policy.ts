import type { BufferedHeartbeatSnapshot } from './watch.types.js';

export const BUFFERED_HEARTBEAT_EVENT_TYPES = new Set(['playback_progress']);

export const HEARTBEAT_POLICY = {
  minimumResumePositionSeconds: 90,
  minimumResumePercent: 3,
  meaningfulPositionDeltaSeconds: 120,
  meaningfulProgressDeltaPercent: 5,
  completionPercent: 90,
  safetyFlushWindowSeconds: 300,
  initialFlushDelayMs: 15000,
  recheckDelayMs: 60000,
  bufferTtlSeconds: 1800,
} as const;

export type PersistedProgressSnapshot = {
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number;
  status: string;
  lastPlayedAt: string;
};

export type HeartbeatDecision =
  | { action: 'persist'; reason: string; progressPercent: number }
  | { action: 'keep_buffer'; reason: string; progressPercent: number }
  | { action: 'clear_buffer'; reason: string; progressPercent: number };

export function isBufferedHeartbeatEvent(eventType: string): boolean {
  return BUFFERED_HEARTBEAT_EVENT_TYPES.has(eventType);
}

export function evaluateHeartbeatSnapshot(
  snapshot: BufferedHeartbeatSnapshot,
  current: PersistedProgressSnapshot | null,
): HeartbeatDecision {
  const progressPercent = deriveProgressPercent(snapshot.positionSeconds, snapshot.durationSeconds);
  const positionSeconds = snapshot.positionSeconds ?? 0;
  const occurredAtMs = Date.parse(snapshot.occurredAt);

  if (!Number.isFinite(occurredAtMs)) {
    return { action: 'clear_buffer', reason: 'invalid_occurred_at', progressPercent };
  }

  if (current) {
    const currentPlayedAtMs = Date.parse(current.lastPlayedAt);
    if (Number.isFinite(currentPlayedAtMs) && occurredAtMs < currentPlayedAtMs) {
      return { action: 'clear_buffer', reason: 'stale_snapshot', progressPercent };
    }

    if (current.status === 'completed' && Number.isFinite(currentPlayedAtMs) && occurredAtMs <= currentPlayedAtMs) {
      return { action: 'clear_buffer', reason: 'already_completed', progressPercent };
    }
  }

  if (progressPercent >= HEARTBEAT_POLICY.completionPercent) {
    return { action: 'persist', reason: 'completion_edge', progressPercent };
  }

  if (!isResumeWorthy(positionSeconds, progressPercent)) {
    return { action: 'keep_buffer', reason: 'not_resume_worthy_yet', progressPercent };
  }

  if (!current) {
    return { action: 'persist', reason: 'first_resume_point', progressPercent };
  }

  const currentPosition = current.positionSeconds ?? 0;
  const positionDelta = Math.max(0, positionSeconds - currentPosition);
  if (positionDelta >= HEARTBEAT_POLICY.meaningfulPositionDeltaSeconds) {
    return { action: 'persist', reason: 'time_delta', progressPercent };
  }

  const progressDelta = Math.max(0, progressPercent - current.progressPercent);
  if (progressDelta >= HEARTBEAT_POLICY.meaningfulProgressDeltaPercent) {
    return { action: 'persist', reason: 'progress_delta', progressPercent };
  }

  const currentPlayedAtMs = Date.parse(current.lastPlayedAt);
  if (Number.isFinite(currentPlayedAtMs) && occurredAtMs - currentPlayedAtMs >= HEARTBEAT_POLICY.safetyFlushWindowSeconds * 1000) {
    return { action: 'persist', reason: 'safety_window', progressPercent };
  }

  return { action: 'keep_buffer', reason: 'below_threshold', progressPercent };
}

export function deriveProgressPercent(positionSeconds?: number | null, durationSeconds?: number | null): number {
  if (!positionSeconds || !durationSeconds || durationSeconds <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(((positionSeconds / durationSeconds) * 100).toFixed(2))));
}

function isResumeWorthy(positionSeconds: number, progressPercent: number): boolean {
  return (
    positionSeconds >= HEARTBEAT_POLICY.minimumResumePositionSeconds ||
    progressPercent >= HEARTBEAT_POLICY.minimumResumePercent
  );
}
