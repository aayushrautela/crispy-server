import { HttpError } from '../../lib/errors.js';
import { withDbClient } from '../../lib/db.js';
import { normalizeMetadataLanguage } from '../metadata/metadata-language.js';
import { RecommendationOutboxService } from '../outbox/recommendation-outbox.service.js';

export type ProfileRecord = {
  id: string;
  name: string;
  interfaceLanguage: string;
  region: string | null;
  avatarKey: string | null;
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
  avatarKey?: string | null;
  isKids?: boolean;
  sortOrder?: number;
};

export type ProfileUpdateInput = {
  name?: string;
  interfaceLanguage?: string;
  region?: string | null;
  avatarKey?: string | null;
  isKids?: boolean;
  sortOrder?: number;
};

function mapRow(row: Record<string, unknown>): ProfileRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    interfaceLanguage: typeof row.interface_language === 'string' ? row.interface_language : 'en',
    region: typeof row.region === 'string' ? row.region : null,
    avatarKey: typeof row.avatar_key === 'string' ? row.avatar_key : null,
    isKids: Boolean(row.is_kids),
    sortOrder: Number(row.sort_order),
    createdByUserId: typeof row.created_by_account_id === 'string' ? row.created_by_account_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeRequiredName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) {
    throw new HttpError(400, 'Profile name is required.');
  }
  return name;
}

export function normalizeRequiredProfileLanguage(value: unknown): string {
  const normalized = normalizeMetadataLanguage(typeof value === 'string' ? value : null);
  if (!normalized) {
    throw new HttpError(400, 'Profile language is required.');
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
  const region = value.trim().replaceAll('_', '-');
  if (!region) {
    return null;
  }
  if (!/^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(region)) {
    throw new HttpError(400, 'Profile region must be a valid country or region code.');
  }
  return region
    .split('-')
    .map((part, index) => (index === 0 || part.length === 2 ? part.toUpperCase() : part.toLowerCase()))
    .join('-');
}

export class ProfileLocalService {
  constructor(
    private readonly recommendationOutboxService = new RecommendationOutboxService(),
  ) {}

  async listForAccount(authSubject: string): Promise<ProfileRecord[]> {
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id, created_at, updated_at
         FROM identity.profiles
         WHERE account_id = $1::uuid AND deleted_at IS NULL
         ORDER BY sort_order ASC, created_at ASC`,
        [authSubject],
      );
      return result.rows.map((r) => mapRow(r));
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
      const countResult = await client.query(
        `SELECT COUNT(*) AS cnt FROM identity.profiles WHERE account_id = $1::uuid AND deleted_at IS NULL`,
        [authSubject],
      );
      const count = Number(countResult.rows[0]?.cnt ?? 0);

      const result = await client.query(
        `INSERT INTO identity.profiles (account_id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid)
         RETURNING id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id, created_at, updated_at`,
        [authSubject, name, interfaceLanguage, region, input.avatarKey ?? null, input.isKids ?? false, input.sortOrder ?? count, authSubject],
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
      if (input.avatarKey !== undefined) {
        updates.push(`avatar_key = $${paramIdx}`);
        params.push(input.avatarKey);
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
          RETURNING id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id, created_at, updated_at`,
        params,
      );

      if (!result.rows[0]) throw new HttpError(404, 'Profile not found.');
      return mapRow(result.rows[0]);
    });
  }

  async requireOwnedProfile(authSubject: string, profileId: string): Promise<ProfileRecord> {
    return withDbClient(async (client) => {
      const result = await client.query(
        `SELECT id, name, interface_language, region, avatar_key, is_kids, sort_order, created_by_account_id, created_at, updated_at
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
