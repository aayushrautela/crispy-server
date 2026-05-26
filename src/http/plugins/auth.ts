import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { verifyAuthJwt } from '../../lib/jwks.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor, AuthScope, UserAuthActor } from '../../modules/auth/auth.types.js';
import { USER_DEFAULT_SCOPES } from '../../modules/auth/auth.types.js';
import { PersonalAccessTokenService } from '../../modules/auth/personal-access-token.service.js';
import { db } from '../../lib/db.js';
import { normalizeMetadataLanguage } from '../../modules/metadata/metadata-language.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthActor;
  }

  interface FastifyInstance {
    requireAuth(request: import('fastify').FastifyRequest): Promise<void>;
    requireUserActor(request: import('fastify').FastifyRequest): UserAuthActor;
    requireUserSessionActor(request: import('fastify').FastifyRequest): UserAuthActor;
    requireScopes(request: import('fastify').FastifyRequest, scopes: AuthScope[]): void;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const patService = new PersonalAccessTokenService();

  fastify.decorateRequest('auth');

  fastify.decorate('requireAuth', async (request: import('fastify').FastifyRequest) => {
    const header = request.headers.authorization?.trim();
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing bearer token.');
    }

    const token = header.slice('Bearer '.length).trim();

    if (token.startsWith('cp_pat_')) {
      const actor = await patService.authenticate(token);
      if (!actor) {
        throw new HttpError(401, 'Invalid bearer token.');
      }
      request.auth = actor;
      request.auth.accessToken = null;
      return;
    }

    let payload;
    try {
      payload = await verifyAuthJwt(token);
    } catch {
      throw new HttpError(401, 'Invalid bearer token.');
    }

    const displayName = deriveProfileName(payload);
    const interfaceLanguage = deriveProfileLanguage(payload);
    const region = deriveProfileRegion(payload);
    const client = await db.connect();
    try {
      await client.query('SELECT identity.upsert_account($1, $2, $3)', [
        payload.sub,
        typeof payload.email === 'string' ? payload.email : null,
        displayName,
      ]);

      const profileCheck = await client.query(
        `SELECT id FROM identity.profiles WHERE account_id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
        [payload.sub],
      );
      if (profileCheck.rows.length === 0) {
        const profileResult = await client.query(
          `INSERT INTO identity.profiles (account_id, name, interface_language, region, sort_order, created_by_account_id)
           VALUES ($1::uuid, $2, $3, $4, 0, $1::uuid)
           RETURNING id`,
          [payload.sub, displayName, interfaceLanguage, region],
        );
        const profileId = profileResult.rows[0].id;
        await client.query(
          `INSERT INTO identity.profile_members (profile_id, account_id, role)
           VALUES ($1::uuid, $2::uuid, 'owner')`,
          [profileId, payload.sub],
        );
        await client.query(
          `INSERT INTO identity.profile_preferences (profile_id, settings_json)
           VALUES ($1::uuid, '{}'::jsonb)`,
          [profileId],
        );
      }
    } finally {
      client.release();
    }

    request.auth = {
      type: 'user',
      appUserId: payload.sub,
      serviceId: null,
      scopes: USER_DEFAULT_SCOPES,
      authSubject: payload.sub,
      email: payload.email ?? null,
      tokenId: null,
      consumerId: null,
      accessToken: null,
    };
  });

  fastify.decorate('requireUserActor', (request: import('fastify').FastifyRequest) => {
    const auth = request.auth;
    if (!auth?.appUserId || (auth.type !== 'user' && auth.type !== 'pat')) {
      throw new HttpError(403, 'User authentication required.');
    }
    return auth as UserAuthActor;
  });

  fastify.decorate('requireUserSessionActor', (request: import('fastify').FastifyRequest) => {
    const auth = request.auth;
    if (!auth?.appUserId || auth.type !== 'user') {
      throw new HttpError(403, 'User session authentication required.');
    }
    return auth as UserAuthActor;
  });

  fastify.decorate('requireScopes', (request: import('fastify').FastifyRequest, scopes: AuthScope[]) => {
    const granted = new Set(request.auth?.scopes ?? []);
    for (const scope of scopes) {
      if (!granted.has(scope)) {
        throw new HttpError(403, `Missing required scope: ${scope}`);
      }
    }
  });
};

function deriveProfileName(payload: Record<string, unknown>): string {
  for (const key of ['full_name', 'name', 'display_name']) {
    const value = readMetadataString(payload, key);
    if (value) return value;
  }
  if (typeof payload.email === 'string') {
    const localPart = payload.email.split('@')[0]?.trim();
    if (localPart) return localPart;
  }
  return 'Main';
}

function deriveProfileLanguage(payload: Record<string, unknown>): string {
  for (const key of ['interfaceLanguage', 'interface_language', 'locale', 'language']) {
    const normalized = normalizeMetadataLanguage(readMetadataString(payload, key));
    if (normalized) return normalized;
  }
  return 'en';
}

function deriveProfileRegion(payload: Record<string, unknown>): string | null {
  for (const key of ['region', 'country', 'country_code']) {
    const value = readMetadataString(payload, key);
    if (value) return normalizeRegion(value);
  }
  return null;
}

function readMetadataString(payload: Record<string, unknown>, key: string): string | null {
  for (const container of [payload, asRecord(payload.user_metadata), asRecord(payload.raw_user_meta_data), asRecord(payload.app_metadata)]) {
    const value = container?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeRegion(value: string): string | null {
  const region = value.trim().replaceAll('_', '-');
  if (!/^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(region)) return null;
  return region
    .split('-')
    .map((part, index) => (index === 0 || part.length === 2 ? part.toUpperCase() : part.toLowerCase()))
    .join('-');
}

export default fp(authPlugin, { name: 'auth-plugin' });
