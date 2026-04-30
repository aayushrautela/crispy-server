import type pg from 'pg';

type QueryableDb = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface ProfileEligibilityInputs {
  accountId: string;
  profileId: string;
  accountActive: boolean;
  profileActive: boolean;
  profileDeleted: boolean;
  profileLocked: boolean;
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
    const result = await this.deps.db.query(
      `SELECT 
         p.id AS profile_id,
         pg.owner_user_id AS account_id,
         (au.id IS NOT NULL) AS account_active,
         (p.id IS NOT NULL) AS profile_active,
         false AS profile_deleted,
         false AS profile_locked,
         COALESCE((ps.settings_json->>'recommendations.enabled')::boolean, true) AS recommendations_enabled,
         COALESCE((ps.settings_json->>'ai.personalization_enabled')::boolean, true) AS ai_personalization_enabled,
         COALESCE((acs.settings_json->>'personalization.enabled')::boolean, true) AS account_allows_personalization,
         true AS consent_allows_processing,
         true AS maturity_policy_allows_reco,
         true AS jurisdiction_allows_processing
       FROM profiles p
       INNER JOIN profile_groups pg ON pg.id = p.profile_group_id
       INNER JOIN app_users au ON au.id = pg.owner_user_id
       LEFT JOIN profile_settings ps ON ps.profile_id = p.id
       LEFT JOIN account_settings acs ON acs.app_user_id = pg.owner_user_id
       WHERE pg.owner_user_id = $1::uuid
         AND p.id = $2::uuid`,
      [input.accountId, input.profileId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      accountId: input.accountId,
      profileId: input.profileId,
      accountActive: row.account_active,
      profileActive: row.profile_active,
      profileDeleted: row.profile_deleted,
      profileLocked: row.profile_locked,
      recommendationsEnabled: row.recommendations_enabled,
      aiPersonalizationEnabled: row.ai_personalization_enabled,
      accountAllowsPersonalization: row.account_allows_personalization,
      consentAllowsProcessing: row.consent_allows_processing,
      maturityPolicyAllowsReco: row.maturity_policy_allows_reco,
      jurisdictionAllowsProcessing: row.jurisdiction_allows_processing,
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
