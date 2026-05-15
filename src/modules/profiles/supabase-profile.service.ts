import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import { RecommendationOutboxService } from '../outbox/recommendation-outbox.service.js';
import { withDbClient } from '../../lib/db.js';

export type SupabaseProfileRecord = {
  id: string;
  name: string;
  avatarKey: string | null;
  isKids: boolean;
  sortOrder: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: Record<string, unknown>): SupabaseProfileRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    avatarKey: typeof row.avatar_key === 'string' ? row.avatar_key : null,
    isKids: Boolean(row.is_kids),
    sortOrder: Number(row.sort_order),
    createdByUserId: typeof row.created_by_account_id === 'string' ? row.created_by_account_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SupabaseProfileService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly recommendationOutboxService = new RecommendationOutboxService(),
  ) {}

  async listForAccount(authSubject: string): Promise<SupabaseProfileRecord[]> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, name, avatar_key, is_kids, sort_order, created_by_account_id, created_at, updated_at')
      .eq('account_id', authSubject)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => mapRow(r));
  }

  async create(
    authSubject: string,
    input: { name: string; avatarKey?: string | null; isKids?: boolean; sortOrder?: number },
  ): Promise<SupabaseProfileRecord> {
    const { count } = await this.supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', authSubject)
      .is('deleted_at', null);

    const { data, error } = await this.supabase
      .from('profiles')
      .insert({
        account_id: authSubject,
        name: input.name.trim(),
        avatar_key: input.avatarKey ?? null,
        is_kids: input.isKids ?? false,
        sort_order: input.sortOrder ?? (count ?? 0),
        created_by_account_id: authSubject,
      })
      .select('id, name, avatar_key, is_kids, sort_order, created_by_account_id, created_at, updated_at')
      .single();

    if (error) throw error;

    await this.supabase.from('profile_members').insert({
      profile_id: data.id,
      account_id: authSubject,
      role: 'owner',
    });

    await this.supabase.from('profile_preferences').insert({
      profile_id: data.id,
      settings_json: {},
    });

    await withDbClient((client) =>
      this.recommendationOutboxService.appendRecomputeRequested(client, {
        userId: authSubject,
        profileId: data.id,
        reason: 'profile_created',
      }),
    );

    return mapRow(data as unknown as Record<string, unknown>);
  }

  async update(
    authSubject: string,
    profileId: string,
    input: { name?: string; avatarKey?: string | null; isKids?: boolean; sortOrder?: number },
  ): Promise<SupabaseProfileRecord> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.avatarKey !== undefined) updates.avatar_key = input.avatarKey;
    if (input.isKids !== undefined) updates.is_kids = input.isKids;
    if (input.sortOrder !== undefined) updates.sort_order = input.sortOrder;

    const { data, error } = await this.supabase
      .from('profiles')
      .update(updates)
      .eq('id', profileId)
      .eq('account_id', authSubject)
      .is('deleted_at', null)
      .select('id, name, avatar_key, is_kids, sort_order, created_by_account_id, created_at, updated_at')
      .single();

    if (error || !data) throw new HttpError(404, 'Profile not found.');
    return mapRow(data as unknown as Record<string, unknown>);
  }

  async requireOwnedProfile(authSubject: string, profileId: string): Promise<SupabaseProfileRecord> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, name, avatar_key, is_kids, sort_order, created_by_account_id, created_at, updated_at')
      .eq('id', profileId)
      .eq('account_id', authSubject)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new HttpError(404, 'Profile not found.');
    return mapRow(data as unknown as Record<string, unknown>);
  }

  async requireProfileOwnerAccountId(profileId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('account_id')
      .eq('id', profileId)
      .is('deleted_at', null)
      .single();

    if (error || !data) throw new HttpError(404, 'Profile not found.');
    return String(data.account_id);
  }

  async getSettings(authSubject: string, profileId: string): Promise<Record<string, unknown>> {
    const profile = await this.requireOwnedProfile(authSubject, profileId);

    const { data, error } = await this.supabase
      .from('profile_preferences')
      .select('settings_json')
      .eq('profile_id', profile.id)
      .single();

    if (error || !data) return {};
    return (data.settings_json ?? {}) as Record<string, unknown>;
  }

  async patchSettings(
    authSubject: string,
    profileId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.requireOwnedProfile(authSubject, profileId);

    const { data: current } = await this.supabase
      .from('profile_preferences')
      .select('settings_json')
      .eq('profile_id', profileId)
      .single();

    const merged = { ...((current?.settings_json ?? {}) as Record<string, unknown>), ...patch };

    const { data, error } = await this.supabase
      .from('profile_preferences')
      .upsert({ profile_id: profileId, settings_json: merged, updated_at: new Date().toISOString() })
      .select('settings_json')
      .single();

    if (error) throw error;

    await withDbClient((client) =>
      this.recommendationOutboxService.appendRecomputeRequested(client, {
        userId: authSubject,
        profileId,
        reason: 'profile_settings_changed',
      }),
    );

    return (data.settings_json ?? {}) as Record<string, unknown>;
  }
}
