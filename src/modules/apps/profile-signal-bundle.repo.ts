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

  async listHistory(_input: SignalListInput): Promise<ProfileHistorySignal[]> {
    return [];
  }

  async listRatings(_input: SignalListInput): Promise<ProfileRatingSignal[]> {
    return [];
  }

  async listWatchlist(_input: SignalListInput): Promise<ProfileWatchlistSignal[]> {
    return [];
  }

  async listContinueWatching(_input: SignalListInput): Promise<ProfileContinueWatchingSignal[]> {
    return [];
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
