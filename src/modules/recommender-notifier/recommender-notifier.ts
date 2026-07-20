import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

export type RecomputeReason =
  | 'watch_history_changed'
  | 'rating_changed'
  | 'watchlist_changed'
  | 'playback_progress_changed'
  | 'profile_created'
  | 'profile_settings_changed'
  | 'trakt_linked'
  | 'import_completed'
  | 'admin_requested';

export type NotifyRecomputeInput = {
  accountId: string;
  profileId: string;
  reason: RecomputeReason;
};

export type RecommenderNotifierOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
};

/**
 * Fire-and-forget notifier for the external recommender engine.
 *
 * Crispy's only responsibility is "tell reco that profile X needs new reco,
 * here's why." Reco then pulls whatever context it needs (continue-watching,
 * watch history, ratings, watchlist) from crispy's read APIs and pushes the
 * result back via the unified home-ingest pipeline.
 *
 * No persistence, no retries, no batch dispatch, no admin UI for recompute
 * jobs. If the POST fails, it fails; the next change fires another one. Reco
 * is idempotent on profileId so missed/lost/duplicate notifications converge
 * to the right state on the next one.
 *
 * When `baseUrl` is empty the notifier is a no-op (used in local dev where
 * the reco engine isn't running). All network errors are caught and logged
 * at `warn` level so a flaky reco endpoint never breaks the request path.
 */
export class RecommenderNotifier {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(opts: RecommenderNotifierOptions) {
    this.baseUrl = opts.baseUrl;
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  /** Fire a single notification. Returns immediately (does not await the POST). */
  notifyRecompute(input: NotifyRecomputeInput): void {
    if (!this.baseUrl) {
      logger.debug({ profileId: input.profileId, reason: input.reason }, 'recommender notifier disabled (no baseUrl)');
      return;
    }
    void this.post(input).catch((err) => {
      logger.warn(
        { err, profileId: input.profileId, reason: input.reason },
        'recommender notify failed (fire-and-forget)',
      );
    });
  }

  private async post(input: NotifyRecomputeInput): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          eventId: `crispy-${input.profileId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          eventType: 'recommendation.recompute_requested',
          eventVersion: 1,
          aggregateType: 'profile',
          aggregateId: input.profileId,
          userId: input.accountId,
          profileId: input.profileId,
          source: 'crispy-server',
          payload: { reason: input.reason },
        }),
        signal: controller.signal,
      });
      if (!res.ok && res.status !== 409) {
        logger.warn(
          { status: res.status, profileId: input.profileId, reason: input.reason },
          'recommender notify non-2xx response',
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Process-wide singleton. Built lazily on first access from env so test code
 * can stub `globalThis.fetch` before the first call. Returns `null` when the
 * reco engine isn't configured (local dev / missing env).
 */
let cachedSingleton: RecommenderNotifier | null | undefined;
export function getRecommenderNotifier(): RecommenderNotifier | null {
  if (cachedSingleton !== undefined) return cachedSingleton;
  cachedSingleton =
    env.recommenderInternalBaseUrl && env.mainToRecommenderServiceToken
      ? new RecommenderNotifier({
          baseUrl: env.recommenderInternalBaseUrl,
          token: env.mainToRecommenderServiceToken,
          timeoutMs: env.recommenderNotifyTimeoutMs,
        })
      : null;
  return cachedSingleton;
}

/** Test-only: reset the cached singleton (e.g. after stubbing env in a test). */
export function resetRecommenderNotifierSingletonForTests(): void {
  cachedSingleton = undefined;
}
