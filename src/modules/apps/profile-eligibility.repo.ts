import type pg from 'pg';
import { HttpError } from '../../lib/errors.js';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;
type PreferenceRow = { settings_json: Record<string, unknown> | null };
type AccountRow = { id: string; deleted_at: string | null };
type ProfileRow = { id: string; account_id: string; deleted_at: string | null };

export interface ProfileEligibilityInputs {
  accountId: string;
  profileId: string;
  accountActive: boolean;
  profileActive: boolean;
  profileDeleted: boolean;
  profileLocked: boolean;
  useOfficialRecommendationEngine: boolean;
  recommendationsEnabled: boolean;
  aiPersonalizationEnabled: boolean;
  accountAllowsPersonalization: boolean;
  consentAllowsProcessing: boolean;
  maturityPolicyAllowsReco: boolean;
  jurisdictionAllowsProcessing: boolean;
}

export interface UpsertEligibilityProjectionInput {
  accountId: string;
  profileId: string;
  purpose: string;
  eligible: boolean;
  reasons: string[];
  policy: Record<string, boolean>;
  eligibilityVersion: number;
  updatedAt: Date;
}

export interface ProfileEligibilityRepo {
  loadEligibilityInputs(input: { accountId: string; profileId: string }): Promise<ProfileEligibilityInputs | null>;
  getCurrentEligibilityVersion(input: { accountId: string; profileId: string; purpose: string }): Promise<number>;
  incrementEligibilityVersion(input: { accountId: string; profileId: string; purpose: string; reason: string }): Promise<number>;
  upsertEligibilityProjection(input: UpsertEligibilityProjectionInput): Promise<void>;
}

export class SqlProfileEligibilityRepo implements ProfileEligibilityRepo {
  constructor(private readonly deps: { db: QueryableDb }) {}

  async loadEligibilityInputs(input: { accountId: string; profileId: string }): Promise<ProfileEligibilityInputs | null> {
    const [accountResult, profileResult, profilePreferencesResult, accountPreferencesResult] = await Promise.all([
      this.deps.db.query(`SELECT id, deleted_at FROM identity.accounts WHERE id = $1::uuid`, [input.accountId]),
      this.deps.db.query(`SELECT id, account_id, deleted_at FROM identity.profiles WHERE id = $1::uuid AND account_id = $2::uuid`, [input.profileId, input.accountId]),
      this.deps.db.query(`SELECT settings_json FROM identity.profile_preferences WHERE profile_id = $1::uuid`, [input.profileId]),
      this.deps.db.query(`SELECT settings_json FROM identity.account_preferences WHERE account_id = $1::uuid`, [input.accountId]),
    ]);

    const account = accountResult.rows[0] as AccountRow | undefined;
    const profile = profileResult.rows[0] as ProfileRow | undefined;

    if (!account || !profile) return null;

    const profileSettings = asRecord((profilePreferencesResult.rows[0] as PreferenceRow | undefined)?.settings_json);
    const accountSettings = asRecord((accountPreferencesResult.rows[0] as PreferenceRow | undefined)?.settings_json);
    const recommendations = asRecord(profileSettings.recommendations);
    const ai = asRecord(profileSettings.ai);
    const personalization = asRecord(accountSettings.personalization);

    return {
      accountId: input.accountId,
      profileId: input.profileId,
      accountActive: account.deleted_at === null,
      profileActive: profile.deleted_at === null,
      profileDeleted: profile.deleted_at !== null,
      profileLocked: false,
      useOfficialRecommendationEngine: readBoolean(recommendations.useOfficialEngine, true),
      recommendationsEnabled: readBoolean(recommendations.enabled, true),
      aiPersonalizationEnabled: readBoolean(ai.personalizationEnabled, readBoolean(profileSettings['ai.personalization_enabled'], true)),
      accountAllowsPersonalization: readBoolean(personalization.enabled, readBoolean(accountSettings['personalization.enabled'], true)),
      consentAllowsProcessing: true,
      maturityPolicyAllowsReco: true,
      jurisdictionAllowsProcessing: true,
    };
  }

  async getCurrentEligibilityVersion(input: { accountId: string; profileId: string; purpose: string }): Promise<number> {
    const result = await this.deps.db.query(
      `SELECT eligibility_version
       FROM profile_eligibility_projections
       WHERE account_id = $1::uuid
         AND profile_id = $2::uuid
         AND purpose = $3`,
      [input.accountId, input.profileId, input.purpose],
    );
    return result.rows[0]?.eligibility_version ?? 0;
  }

  async incrementEligibilityVersion(input: { accountId: string; profileId: string; purpose: string; reason: string }): Promise<number> {
    const result = await this.deps.db.query(
      `INSERT INTO profile_eligibility_projections
         (account_id, profile_id, purpose, eligibility_version, eligible, reasons, policy, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, 1, false, $4::jsonb, '{}'::jsonb, now())
       ON CONFLICT (account_id, profile_id, purpose)
       DO UPDATE SET
         eligibility_version = profile_eligibility_projections.eligibility_version + 1,
         updated_at = now()
       RETURNING eligibility_version`,
      [input.accountId, input.profileId, input.purpose, JSON.stringify([input.reason])],
    );
    return result.rows[0].eligibility_version;
  }

  async upsertEligibilityProjection(input: UpsertEligibilityProjectionInput): Promise<void> {
    await this.deps.db.query(
      `INSERT INTO profile_eligibility_projections
         (account_id, profile_id, purpose, eligible, reasons, policy, eligibility_version, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
       ON CONFLICT (account_id, profile_id, purpose)
       DO UPDATE SET
         eligible = EXCLUDED.eligible,
         reasons = EXCLUDED.reasons,
         policy = EXCLUDED.policy,
         eligibility_version = EXCLUDED.eligibility_version,
         updated_at = EXCLUDED.updated_at`,
      [
        input.accountId,
        input.profileId,
        input.purpose,
        input.eligible,
        JSON.stringify(input.reasons),
        JSON.stringify(input.policy),
        input.eligibilityVersion,
        input.updatedAt,
      ],
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
