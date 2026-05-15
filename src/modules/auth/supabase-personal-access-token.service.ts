import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor, AuthScope } from './auth.types.js';
import { PAT_DEFAULT_SCOPES, isPersonalAccessTokenScope } from './auth.types.js';
import { hashAccessToken } from './token-hash.js';
import { withDbClient } from '../../lib/db.js';
import { ServiceOutboxRepository } from '../outbox/service-outbox.repo.js';

export type PersonalAccessTokenView = {
  id: string;
  name: string;
  tokenPreview: string;
  scopes: AuthScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreatedPersonalAccessToken = {
  token: PersonalAccessTokenView;
  plaintextToken: string;
};

export class SupabasePersonalAccessTokenService {
  constructor(
    private readonly supabase: SupabaseClient,
  ) {}

  async createForUser(authSubject: string, input: {
    name: string;
    scopes?: AuthScope[];
    expiresAt?: string | null;
  }): Promise<CreatedPersonalAccessToken> {
    const name = input.name.trim();
    if (!name) {
      throw new HttpError(400, 'Token name is required.');
    }

    const scopes = normalizeScopes(input.scopes);
    const rawSecret = randomBytes(24).toString('base64url');
    const plaintextToken = `cp_pat_${rawSecret}`;
    const tokenHash = hashAccessToken(plaintextToken);
    const tokenPreview = plaintextToken.slice(0, 12);

    const { data, error } = await this.supabase
      .from('personal_access_tokens')
      .insert({
        account_id: authSubject,
        name,
        token_hash: tokenHash,
        token_preview: tokenPreview,
        scopes,
        expires_at: input.expiresAt ?? null,
      })
      .select('id, name, token_preview, scopes, expires_at, last_used_at, revoked_at, created_at')
      .single();

    if (error) throw error;

    return {
      token: mapView(data as Record<string, unknown>),
      plaintextToken,
    };
  }

  async listForUser(authSubject: string): Promise<PersonalAccessTokenView[]> {
    const { data, error } = await this.supabase
      .from('personal_access_tokens')
      .select('id, name, token_preview, scopes, expires_at, last_used_at, revoked_at, created_at')
      .eq('account_id', authSubject)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => mapView(r));
  }

  async revokeForUser(authSubject: string, tokenId: string): Promise<PersonalAccessTokenView> {
    const { data, error } = await this.supabase
      .from('personal_access_tokens')
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', tokenId)
      .eq('account_id', authSubject)
      .is('revoked_at', null)
      .select('id, name, token_preview, scopes, expires_at, last_used_at, revoked_at, created_at')
      .single();

    if (error || !data) throw new HttpError(404, 'Personal access token not found.');
    return mapView(data as Record<string, unknown>);
  }

  async revokeAllForUser(authSubject: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('personal_access_tokens')
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('account_id', authSubject)
      .is('revoked_at', null)
      .select('id');

    if (error) throw error;
    return (data ?? []).length;
  }

  async authenticate(rawToken: string): Promise<AuthActor | null> {
    const tokenHash = hashAccessToken(rawToken);

    const { data: token, error } = await this.supabase
      .from('personal_access_tokens')
      .select('id, account_id, scopes, expires_at')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle();

    if (error || !token) return null;

    if (token.expires_at && new Date(token.expires_at) <= new Date()) {
      return null;
    }

    // Look up account for email
    const { data: account } = await this.supabase
      .from('accounts')
      .select('email')
      .eq('id', token.account_id)
      .single();

    // Touch last_used_at
    await this.supabase
      .from('personal_access_tokens')
      .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', token.id);

    return {
      type: 'pat',
      appUserId: token.account_id,
      serviceId: null,
      scopes: Array.isArray(token.scopes) ? token.scopes.filter((s): s is AuthScope => typeof s === 'string') : [],
      authSubject: token.account_id,
      email: account?.email ?? null,
      tokenId: token.id,
      consumerId: null,
      accessToken: null,
    };
  }
}

function normalizeScopes(scopes?: AuthScope[]): AuthScope[] {
  const values = scopes?.length ? scopes : PAT_DEFAULT_SCOPES;
  return Array.from(new Set(values.filter(isPersonalAccessTokenScope)));
}

function mapView(row: Record<string, unknown>): PersonalAccessTokenView {
  return {
    id: String(row.id),
    name: String(row.name),
    tokenPreview: String(row.token_preview),
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is AuthScope => typeof s === 'string') : [],
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
  };
}
