import type { DbClient } from '../../lib/db.js';
import type { AppUser } from './user.types.js';

function mapUserRow(row: Record<string, unknown>): AppUser {
  return {
    id: String(row.id),
    supabaseAuthUserId: String(row.supabase_auth_user_id),
    email: typeof row.email === 'string' ? row.email : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastSeenAt: String(row.last_seen_at),
  };
}

export class UserRepository {
  async findById(client: DbClient, userId: string): Promise<AppUser | null> {
    const result = await client.query(
      `
        SELECT id, supabase_auth_user_id, email, created_at, updated_at, last_seen_at
        FROM app_users
        WHERE id = $1::uuid
      `,
      [userId],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async findBySupabaseAuthUserId(client: DbClient, supabaseAuthUserId: string): Promise<AppUser | null> {
    const result = await client.query(
      `
        SELECT id, supabase_auth_user_id, email, created_at, updated_at, last_seen_at
        FROM app_users
        WHERE supabase_auth_user_id = $1
      `,
      [supabaseAuthUserId],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async upsertFromJwt(client: DbClient, params: { supabaseAuthUserId: string; email: string | null }): Promise<AppUser> {
    const result = await client.query(
      `
        INSERT INTO app_users (supabase_auth_user_id, email)
        VALUES ($1::uuid, $2)
        ON CONFLICT (supabase_auth_user_id)
        DO UPDATE SET
          email = EXCLUDED.email,
          updated_at = now(),
          last_seen_at = now()
        RETURNING id, supabase_auth_user_id, email, created_at, updated_at, last_seen_at
      `,
      [params.supabaseAuthUserId, params.email],
    );
    return mapUserRow(result.rows[0]);
  }
}
