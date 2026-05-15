import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import { getSupabaseServiceRoleClient } from '../../lib/supabase.js';

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
  constructor(private readonly deps: { db: QueryableDb; supabase?: SupabaseClient }) {}

  async loadEligibilityInputs(input: { accountId: string; profileId: string }): Promise<ProfileEligibilityInputs | null> {
    const supabase = this.deps.supabase ?? getSupabaseServiceRoleClient();
    const [{ data: account, error: accountError }, { data: profile, error: profileError }, { data: profilePreferences, error: profilePreferencesError }, { data: accountPreferences, error: accountPreferencesError }] = await Promise.all([
      supabase.from('accounts').select('id, deleted_at').eq('id', input.accountId).maybeSingle(),
      supabase.from('profiles').select('id, account_id, deleted_at').eq('id', input.profileId).eq('account_id', input.accountId).maybeSingle(),
      supabase.from('profile_preferences').select('settings_json').eq('profile_id', input.profileId).maybeSingle(),
      supabase.from('account_preferences').select('settings_json').eq('account_id', input.accountId).maybeSingle(),
    ]);

    const error = accountError ?? profileError ?? profilePreferencesError ?? accountPreferencesError;
    if (error) {
      throw new HttpError(502, `Supabase eligibility read failed: ${error.message}`);
    }

    if (!account || !profile) return null;

    const accountRow = account as AccountRow;
    const profileRow = profile as ProfileRow;
    const profileSettings = asRecord((profilePreferences as PreferenceRow | null)?.settings_json);
    const accountSettings = asRecord((accountPreferences as PreferenceRow | null)?.settings_json);
    const recommendations = asRecord(profileSettings.recommendations);
    const ai = asRecord(profileSettings.ai);
    const personalization = asRecord(accountSettings.personalization);

    return {
      accountId: input.accountId,
      profileId: input.profileId,
      accountActive: accountRow.deleted_at === null,
      profileActive: profileRow.deleted_at === null,
      profileDeleted: profileRow.deleted_at !== null,
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
