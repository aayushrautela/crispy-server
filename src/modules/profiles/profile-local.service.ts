import { HttpError } from '../../lib/errors.js';
import { withDbClient, withTransaction } from '../../lib/db.js';
import { normalizeLanguageCode } from '../i18n/supported-languages.js';
import { normalizeCountryCode } from '../i18n/supported-countries.js';
import { validateAvatarId } from './avatars.js';
import type { RecommenderNotifier } from '../recommender-notifier/recommender-notifier.js';
import { enqueueHomeSeed } from '../../lib/queue.js';

export type ProfileRecord = {
  id: string;
  name: string;
  interfaceLanguage: string;
  region: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  requirePinToAddProfiles: boolean;
  hasPin: boolean;
  isKids: boolean;
  sortOrder: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfileCreateInput = {
  name: string;
  interfaceLanguage: string;
  region?: string | null;
  avatarUrl?: string | null;
  isAdmin?: boolean;
  isKids?: boolean;
  sortOrder?: number;
};

export type ProfileUpdateInput = {
  name?: string;
  interfaceLanguage?: string;
  region?: string | null;
  avatarUrl?: string | null;
  isKids?: boolean;
  sortOrder?: number;
};

/**
 * Profile fields that are first-class columns on identity.profiles, not free-form
 * profile preferences. They must never be written into profile_preferences.settings_json
 * (e.g. via the settings PATCH) or they become divergent shadow copies of the column.
 */
const RESERVED_PROFILE_SETTING_KEYS = new Set([
  'interfaceLanguage',
]);

function stripReservedProfileSettingKeys(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!RESERVED_PROFILE_SETTING_KEYS.has(key)) {
      next[key] = value;
    }
  }
  return next;
}

function mapRow(row: Record<string, unknown>): ProfileRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    interfaceLanguage: typeof row.interface_language === 'string' ? row.interface_language : 'en',
    region: typeof row.region === 'string' ? row.region : null,
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    isAdmin: Boolean(row.is_admin),
    requirePinToAddProfiles: Boolean(row.require_pin_to_add_profiles),
    hasPin: Boolean(row.has_pin),
    isKids: Boolean(row.is_kids),
    sortOrder: Number(row.sort_order),
    createdByUserId: typeof row.created_by_account_id === 'string' ? row.created_by_account_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function normalizeRequiredAvatar(value: unknown): string {
  const result = validateAvatarId(value);
  if (!result.ok) {
    throw new HttpError(400, result.reason);
  }
  return result.id;
}

export function normalizeRequiredName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) {
    throw new HttpError(400, 'Profile name is required.');
  }
  return name;
}

export function normalizeRequiredProfileLanguage(value: unknown): string {
  const normalized = normalizeLanguageCode(typeof value === 'string' ? value : null);
  if (!normalized) {
    throw new HttpError(400, 'Profile language is required and must be a supported language code.');
  }
  return normalized;
}

export function normalizeOptionalProfileRegion(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Profile region must be a string.');
  }
  const normalized = normalizeCountryCode(value);
  if (!normalized) {
    throw new HttpError(400, 'Profile region must be a supported country code.');
  }
  return normalized;
}

const LOCAL_PROFILE_COLUMNS = `
  id, name, interface_language, region, avatar_url,
  is_admin, pin_hash IS NOT NULL AS has_pin, require_pin_to_add_profiles,
  is_kids, sort_order, created_by_account_id, created_at, updated_at
`;

/**
 * Name of the partial unique index added by migration 0044. A violation of
 * this index means the account already has a live profile with the same
 * (case/space-insensitive) name.
 */
export const PROFILE_NAME_UNIQUE_INDEX = 'identity_profiles_account_name_uniq';

/**
 * True when a thrown database error is a unique-constraint violation on the
 * per-account profile name index. Used to surface a clean 409 instead of a 500
 * when a client attempts to create a duplicate-named profile.
 */
export function isProfileNameConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (e.code !== '23505') return false;
  const constraint = typeof e.constraint === 'string' ? e.constraint : '';
  const message = typeof e.message === 'string' ? e.message : '';
  return constraint === PROFILE_NAME_UNIQUE_INDEX || message.includes(PROFILE_NAME_UNIQUE_INDEX);
}

export class ProfileLocalService {
  constructor(
    private readonly recommenderNotifier: RecommenderNotifier | null = null,
  ) {}

  async listForAccount(authSubject: string): Promise<ProfileRecord[]> {
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT ${LOCAL_PROFILE_COLUMNS}
         FROM identity.profiles
         WHERE account_id = $1::uuid AND deleted_at IS NULL
         ORDER BY sort_order ASC, created_at ASC`,
        [authSubject],
      );
      return result.rows.map((r) => mapRow(r));
    });
  }

  async getAdminProfile(authSubject: string): Promise<ProfileRecord | null> {
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT ${LOCAL_PROFILE_COLUMNS}
         FROM identity.profiles
         WHERE account_id = $1::uuid AND is_admin AND deleted_at IS NULL
         LIMIT 1`,
        [authSubject],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    });
  }

  async create(
    authSubject: string,
    input: ProfileCreateInput,
  ): Promise<ProfileRecord> {
    return withDbClient(async (client) => {
      const name = normalizeRequiredName(input.name);
      const interfaceLanguage = normalizeRequiredProfileLanguage(input.interfaceLanguage);
      const region = normalizeOptionalProfileRegion(input.region);
      const avatarUrl = normalizeRequiredAvatar(input.avatarUrl);
      const countResult = await client.query(
        `SELECT COUNT(*) AS cnt FROM identity.profiles WHERE account_id = $1::uuid AND deleted_at IS NULL`,
        [authSubject],
      );
      const count = Number(countResult.rows[0]?.cnt ?? 0);

      let profile: Record<string, unknown>;
      try {
        const insertResult = await client.query(
          `INSERT INTO identity.profiles (account_id, name, interface_language, region, avatar_url, is_admin, is_kids, sort_order, created_by_account_id)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
           RETURNING ${LOCAL_PROFILE_COLUMNS}`,
          [authSubject, name, interfaceLanguage, region, avatarUrl, input.isAdmin ?? false, input.isKids ?? false, input.sortOrder ?? count, authSubject],
        );
        const created = insertResult.rows[0];
        if (!created) {
          throw new HttpError(500, 'Profile insert did not return a row.');
        }
        profile = created;
      } catch (err) {
        if (isProfileNameConflict(err)) {
          throw new HttpError(409, 'A profile with this name already exists.', undefined, 'profile_name_exists');
        }
        throw err;
      }

      await client.query(
        `INSERT INTO identity.profile_members (profile_id, account_id, role)
         VALUES ($1::uuid, $2::uuid, 'owner')`,
        [profile.id, authSubject],
      );

      await client.query(
        `INSERT INTO identity.profile_preferences (profile_id, settings_json)
         VALUES ($1::uuid, '{}'::jsonb)`,
        [profile.id],
      );

      return mapRow(profile);
    });
  }

  /**
   * Idempotently create the account's first (primary) profile during onboarding.
   *
   * The primary profile is always the account admin and is never a kids
   * profile: those invariants are enforced here (not by the caller) so a
   * partially-onboarded account can never end up without an admin, or with a
   * kids primary profile.
   *
   * If the account already has at least one live profile (a retried bootstrap,
   * or a profile created through another path), the existing profile is
   * returned instead of creating a duplicate. This makes the endpoint safe to
   * call more than once (network retry, double-submit, back/forward nav).
   *
   * Race-safety is provided by two layers:
   *  1. A per-account `pg_advisory_xact_lock` serializes concurrent first
   *     logins so only one bootstrap runs at a time (released on commit).
   *  2. `ON CONFLICT DO NOTHING` lets the database reject any duplicate; the
   *     per-account admin unique index resolves races atomically, with no
   *     check-then-insert window.
   *
   * Callers own any downstream side effects (home seed, recommender notify)
   * via `notifyProfileCreated` so they fire exactly once, on real creation.
   */
  async bootstrapPrimaryProfile(
    accountId: string,
    input: { name: string; interfaceLanguage: string; region?: string | null; avatarUrl: string },
  ): Promise<{ created: boolean; profile: ProfileRecord }> {
    return withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [accountId]);

      const existing = await client.query<Record<string, unknown>>(
        `SELECT ${LOCAL_PROFILE_COLUMNS}
         FROM identity.profiles
         WHERE account_id = $1::uuid AND deleted_at IS NULL
         ORDER BY sort_order ASC, created_at ASC, id ASC
         LIMIT 1`,
        [accountId],
      );
      if (existing.rows[0]) {
        return { created: false, profile: mapRow(existing.rows[0]) };
      }

      const name = normalizeRequiredName(input.name);
      const interfaceLanguage = normalizeRequiredProfileLanguage(input.interfaceLanguage);
      const region = normalizeOptionalProfileRegion(input.region);
      const avatarUrl = normalizeRequiredAvatar(input.avatarUrl);

      const insert = await client.query<Record<string, unknown>>(
        `INSERT INTO identity.profiles
           (account_id, name, interface_language, region, avatar_url, is_admin, is_kids, sort_order, created_by_account_id)
         VALUES ($1::uuid, $2, $3, $4, $5, true, false, 0, $1::uuid)
         ON CONFLICT DO NOTHING
         RETURNING ${LOCAL_PROFILE_COLUMNS}`,
        [accountId, name, interfaceLanguage, region, avatarUrl],
      );

      if (insert.rows[0]) {
        const profile = mapRow(insert.rows[0]);
        await client.query(
          `INSERT INTO identity.profile_members (profile_id, account_id, role)
           VALUES ($1::uuid, $2::uuid, 'owner')`,
          [profile.id, accountId],
        );
        await client.query(
          `INSERT INTO identity.profile_preferences (profile_id, settings_json)
           VALUES ($1::uuid, '{}'::jsonb)`,
          [profile.id],
        );
        return { created: true, profile };
      }

      // Another request won the race (or the per-account admin index
      // conflicted). Reuse the existing profile instead of creating a duplicate.
      const fallback = await client.query<Record<string, unknown>>(
        `SELECT ${LOCAL_PROFILE_COLUMNS}
         FROM identity.profiles
         WHERE account_id = $1::uuid AND deleted_at IS NULL
         ORDER BY sort_order ASC, created_at ASC, id ASC
         LIMIT 1`,
        [accountId],
      );
      const existingRow = fallback.rows[0];
      if (!existingRow) {
        throw new HttpError(500, 'Failed to resolve bootstrapped profile after conflict.');
      }
      return { created: false, profile: mapRow(existingRow) };
    });
  }

  /** Fire post-create signals outside the create transaction so a notifier
   *  failure never rolls back the profile insert. Called by the route layer
   *  right after `create` returns. */
  notifyProfileCreated(accountId: string, profileId: string): void {
    this.recommenderNotifier?.notifyRecompute({
      accountId,
      profileId,
      reason: 'profile_created',
    });
    void enqueueHomeSeed({ accountId, profileId }).catch(() => {
      /* seed is best-effort; resolver returns empty until seed completes */
    });
  }

  async update(
    authSubject: string,
    profileId: string,
    input: ProfileUpdateInput,
  ): Promise<ProfileRecord> {
    return withDbClient(async (client) => {
      const updates: string[] = ['updated_at = now()'];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.name !== undefined) {
        updates.push(`name = $${paramIdx}`);
        params.push(normalizeRequiredName(input.name));
        paramIdx++;
      }
      if (input.interfaceLanguage !== undefined) {
        updates.push(`interface_language = $${paramIdx}`);
        params.push(normalizeRequiredProfileLanguage(input.interfaceLanguage));
        paramIdx++;
      }
      if (input.region !== undefined) {
        updates.push(`region = $${paramIdx}`);
        params.push(normalizeOptionalProfileRegion(input.region));
        paramIdx++;
      }
      if (input.avatarUrl !== undefined) {
        updates.push(`avatar_url = $${paramIdx}`);
        params.push(normalizeRequiredAvatar(input.avatarUrl));
        paramIdx++;
      }
      if (input.isKids !== undefined) {
        updates.push(`is_kids = $${paramIdx}`);
        params.push(input.isKids);
        paramIdx++;
      }
      if (input.sortOrder !== undefined) {
        updates.push(`sort_order = $${paramIdx}`);
        params.push(input.sortOrder);
        paramIdx++;
      }

      params.push(profileId);
      params.push(authSubject);

      const result = await client.query(
        `UPDATE identity.profiles
         SET ${updates.join(', ')}
         WHERE id = $${paramIdx}::uuid AND account_id = $${paramIdx + 1}::uuid AND deleted_at IS NULL
          RETURNING ${LOCAL_PROFILE_COLUMNS}`,
        params,
      );

      if (!result.rows[0]) throw new HttpError(404, 'Profile not found.');
      return mapRow(result.rows[0]);
    });
  }

  async requireOwnedProfile(authSubject: string, profileId: string): Promise<ProfileRecord> {
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT ${LOCAL_PROFILE_COLUMNS}
         FROM identity.profiles
         WHERE id = $1::uuid AND account_id = $2::uuid AND deleted_at IS NULL`,
        [profileId, authSubject],
      );
      if (!result.rows[0]) throw new HttpError(404, 'Profile not found.');
      return mapRow(result.rows[0]);
    });
  }

  async requireProfileOwnerAccountId(profileId: string): Promise<string> {
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT account_id FROM identity.profiles WHERE id = $1::uuid AND deleted_at IS NULL`,
        [profileId],
      );
      if (!result.rows[0]) throw new HttpError(404, 'Profile not found.');
      return String(result.rows[0].account_id);
    });
  }

  async getRecommendationSource(authSubject: string, profileId: string): Promise<string> {
    await this.requireOwnedProfile(authSubject, profileId);
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT recommendation_source FROM identity.profiles WHERE id = $1::uuid AND account_id = $2::uuid AND deleted_at IS NULL`,
        [profileId, authSubject],
      );
      const value = result.rows[0]?.recommendation_source;
      return typeof value === 'string' && value.trim() ? value : 'reco';
    });
  }

  async setRecommendationSource(authSubject: string, profileId: string, value: string): Promise<string> {
    await this.requireOwnedProfile(authSubject, profileId);
    return withDbClient(async (client) => {
      await client.query(
        `UPDATE identity.profiles SET recommendation_source = $3, updated_at = now() WHERE id = $1::uuid AND account_id = $2::uuid AND deleted_at IS NULL`,
        [profileId, authSubject, value],
      );
      return value;
    });
  }

  async getRecommendationSourceUnsafe(profileId: string): Promise<string> {
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT recommendation_source FROM identity.profiles WHERE id = $1::uuid AND deleted_at IS NULL`,
        [profileId],
      );
      const value = result.rows[0]?.recommendation_source;
      return typeof value === 'string' && value.trim() ? value : 'reco';
    });
  }

  async getInterfaceLanguage(profileId: string): Promise<string | null> {
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT interface_language FROM identity.profiles WHERE id = $1::uuid AND deleted_at IS NULL`,
        [profileId],
      );
      const raw = result.rows[0]?.interface_language;
      return typeof raw === 'string' ? raw : null;
    });
  }

  async getSettings(authSubject: string, profileId: string): Promise<Record<string, unknown>> {
    const profile = await this.requireOwnedProfile(authSubject, profileId);

    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT settings_json FROM identity.profile_preferences WHERE profile_id = $1::uuid`,
        [profile.id],
      );
      return (result.rows[0]?.settings_json as Record<string, unknown>) ?? {};
    });
  }

  async patchSettings(
    authSubject: string,
    profileId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.requireOwnedProfile(authSubject, profileId);

    const patchWithoutReserved = stripReservedProfileSettingKeys(patch);
    return withDbClient(async (client) => {
      const currentResult = await client.query(
        `SELECT settings_json FROM identity.profile_preferences WHERE profile_id = $1::uuid`,
        [profileId],
      );
      const current = stripReservedProfileSettingKeys(
        (currentResult.rows[0]?.settings_json as Record<string, unknown>) ?? {},
      );
      const merged = { ...current, ...patchWithoutReserved };

      const result = await client.query(
        `INSERT INTO identity.profile_preferences (profile_id, settings_json, updated_at)
         VALUES ($1::uuid, $2::jsonb, now())
         ON CONFLICT (profile_id)
         DO UPDATE SET settings_json = $2::jsonb, updated_at = now()
         RETURNING settings_json`,
        [profileId, JSON.stringify(merged)],
      );

      return (result.rows[0]?.settings_json as Record<string, unknown>) ?? {};
    });
  }

  /** Fire post-patch signals outside the patch transaction. */
  notifyProfileSettingsChanged(accountId: string, profileId: string): void {
    this.recommenderNotifier?.notifyRecompute({
      accountId,
      profileId,
      reason: 'profile_settings_changed',
    });
  }

  async delete(authSubject: string, profileId: string): Promise<void> {
    return withDbClient(async (client) => {
      const profile = await this.requireOwnedProfile(authSubject, profileId);

      const countResult = await client.query(
        `SELECT COUNT(*) AS cnt FROM identity.profiles WHERE account_id = $1::uuid AND deleted_at IS NULL`,
        [authSubject],
      );
      const count = Number(countResult.rows[0]?.cnt ?? 0);
      if (count <= 1) {
        throw new HttpError(400, 'Cannot delete the only profile in the account.');
      }

      await client.query(
        `UPDATE identity.profiles SET deleted_at = now() WHERE id = $1::uuid AND account_id = $2::uuid`,
        [profile.id, authSubject],
      );
    });
  }
}
