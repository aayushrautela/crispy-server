import { HttpError } from '../../lib/errors.js';
import { withDbClient } from '../../lib/db.js';
import { normalizeLanguageCode } from '../i18n/supported-languages.js';
import { normalizeCountryCode } from '../i18n/supported-countries.js';
import { validateAvatarUrl } from './avatar-url.js';
import { RecommendationOutboxService } from '../outbox/recommendation-outbox.service.js';

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

function normalizeOptionalAvatarUrl(value: unknown): string | null {
  const result = validateAvatarUrl(value);
  if (!result.ok) {
    throw new HttpError(400, result.reason);
  }
  return result.url === '' ? null : result.url;
}

function normalizeRequiredName(value: unknown): string {
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

export class ProfileLocalService {
  constructor(
    private readonly recommendationOutboxService = new RecommendationOutboxService(),
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
      const avatarUrl = normalizeOptionalAvatarUrl(input.avatarUrl);
      const countResult = await client.query(
        `SELECT COUNT(*) AS cnt FROM identity.profiles WHERE account_id = $1::uuid AND deleted_at IS NULL`,
        [authSubject],
      );
      const count = Number(countResult.rows[0]?.cnt ?? 0);

      const result = await client.query(
        `INSERT INTO identity.profiles (account_id, name, interface_language, region, avatar_url, is_admin, is_kids, sort_order, created_by_account_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
         RETURNING ${LOCAL_PROFILE_COLUMNS}`,
        [authSubject, name, interfaceLanguage, region, avatarUrl, input.isAdmin ?? false, input.isKids ?? false, input.sortOrder ?? count, authSubject],
      );

      const profile = result.rows[0];

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

      await this.recommendationOutboxService.appendRecomputeRequested(client, {
        userId: authSubject,
        profileId: profile.id,
        reason: 'profile_created',
      });

      return mapRow(profile);
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
        params.push(normalizeOptionalAvatarUrl(input.avatarUrl));
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

    return withDbClient(async (client) => {
      const currentResult = await client.query(
        `SELECT settings_json FROM identity.profile_preferences WHERE profile_id = $1::uuid`,
        [profileId],
      );
      const current = (currentResult.rows[0]?.settings_json as Record<string, unknown>) ?? {};
      const merged = { ...current, ...patch };

      const result = await client.query(
        `INSERT INTO identity.profile_preferences (profile_id, settings_json, updated_at)
         VALUES ($1::uuid, $2::jsonb, now())
         ON CONFLICT (profile_id)
         DO UPDATE SET settings_json = $2::jsonb, updated_at = now()
         RETURNING settings_json`,
        [profileId, JSON.stringify(merged)],
      );

      await this.recommendationOutboxService.appendRecomputeRequested(client, {
        userId: authSubject,
        profileId,
        reason: 'profile_settings_changed',
      });

      return (result.rows[0]?.settings_json as Record<string, unknown>) ?? {};
    });
  }
}
