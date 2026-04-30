import type pg from 'pg';
import type {
  ProfileContinueWatchingSignal,
  ProfileHistorySignal,
  ProfileLanguageSignals,
  ProfileNegativeSignal,
  ProfileRatingSignal,
  ProfileRecentImpressionSignal,
  ProfileTasteSignals,
  ProfileWatchlistSignal,
  SignalBaseInput,
  SignalListInput,
} from './profile-signal-bundle.types.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface ProfileSignalBundleRepo {
  getSignalsVersion(input: { accountId: string; profileId: string }): Promise<number>;
  listHistory(input: SignalListInput): Promise<ProfileHistorySignal[]>;
  listRatings(input: SignalListInput): Promise<ProfileRatingSignal[]>;
  listWatchlist(input: SignalListInput): Promise<ProfileWatchlistSignal[]>;
  listContinueWatching(input: SignalListInput): Promise<ProfileContinueWatchingSignal[]>;
  getLanguageSignals(input: SignalBaseInput): Promise<ProfileLanguageSignals | null>;
  getTasteSignals(input: SignalBaseInput): Promise<ProfileTasteSignals | null>;
  listNegativeSignals(input: SignalListInput): Promise<ProfileNegativeSignal[]>;
  listRecentImpressions(input: SignalListInput): Promise<ProfileRecentImpressionSignal[]>;
}

export class SqlProfileSignalBundleRepo implements ProfileSignalBundleRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async getSignalsVersion(input: { accountId: string; profileId: string }): Promise<number> {
    const result = await this.deps.db.query(
      `SELECT signals_version FROM profile_signal_versions WHERE account_id = $1::uuid AND profile_id = $2::uuid`,
      [input.accountId, input.profileId],
    );
    return result.rows[0]?.signals_version ?? 0;
  }

  async listHistory(input: SignalListInput): Promise<ProfileHistorySignal[]> {
    const result = await this.deps.db.query(
      `SELECT content_id, content_type, watched_at, progress_percent, completion_state, duration_seconds
       FROM app_profile_history_signals
       WHERE account_id = $1::uuid AND profile_id = $2::uuid
         AND ($3::timestamptz IS NULL OR watched_at >= $3)
       ORDER BY watched_at DESC
       LIMIT $4`,
      [input.accountId, input.profileId, input.since ?? null, input.limit],
    );
    return result.rows.map((row) => ({
      contentId: row.content_id,
      contentType: row.content_type,
      watchedAt: row.watched_at,
      progressPercent: row.progress_percent,
      completionState: row.completion_state,
      durationSeconds: row.duration_seconds,
    }));
  }

  async listRatings(input: SignalListInput): Promise<ProfileRatingSignal[]> {
    const result = await this.deps.db.query(
      `SELECT content_id, rating, rated_at, rating_source
       FROM app_profile_rating_signals
       WHERE account_id = $1::uuid AND profile_id = $2::uuid
         AND ($3::timestamptz IS NULL OR rated_at >= $3)
       ORDER BY rated_at DESC
       LIMIT $4`,
      [input.accountId, input.profileId, input.since ?? null, input.limit],
    );
    return result.rows.map((row) => ({
      contentId: row.content_id,
      rating: row.rating,
      ratedAt: row.rated_at,
      ratingSource: row.rating_source,
    }));
  }

  async listWatchlist(input: SignalListInput): Promise<ProfileWatchlistSignal[]> {
    const result = await this.deps.db.query(
      `SELECT content_id, added_at
       FROM app_profile_watchlist_signals
       WHERE account_id = $1::uuid AND profile_id = $2::uuid
         AND ($3::timestamptz IS NULL OR added_at >= $3)
       ORDER BY added_at DESC
       LIMIT $4`,
      [input.accountId, input.profileId, input.since ?? null, input.limit],
    );
    return result.rows.map((row) => ({ contentId: row.content_id, addedAt: row.added_at }));
  }

  async listContinueWatching(input: SignalListInput): Promise<ProfileContinueWatchingSignal[]> {
    const result = await this.deps.db.query(
      `SELECT content_id, season_number, episode_number, progress_percent, updated_at
       FROM app_profile_continue_watching_signals
       WHERE account_id = $1::uuid AND profile_id = $2::uuid
         AND ($3::timestamptz IS NULL OR updated_at >= $3)
       ORDER BY updated_at DESC
       LIMIT $4`,
      [input.accountId, input.profileId, input.since ?? null, input.limit],
    );
    return result.rows.map((row) => ({
      contentId: row.content_id,
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      progressPercent: row.progress_percent,
      updatedAt: row.updated_at,
    }));
  }

  async getLanguageSignals(input: SignalBaseInput): Promise<ProfileLanguageSignals | null> {
    const result = await this.deps.db.query(
      `SELECT primary_language, ratios
       FROM profile_language_profiles
       WHERE profile_id = $1::uuid AND status = 'ready'`,
      [input.profileId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      primary: row.primary_language,
      secondary: Array.isArray(row.ratios)
        ? row.ratios.map((item: { language?: string }) => item.language).filter((value: string | undefined): value is string => Boolean(value)).slice(1)
        : [],
      audioPreferences: [],
      subtitlePreferences: [],
    };
  }

  async getTasteSignals(_input: SignalBaseInput): Promise<ProfileTasteSignals | null> {
    return { genres: [], people: [], keywords: [] };
  }

  async listNegativeSignals(_input: SignalListInput): Promise<ProfileNegativeSignal[]> {
    return [];
  }

  async listRecentImpressions(_input: SignalListInput): Promise<ProfileRecentImpressionSignal[]> {
    return [];
  }
}
