import type { DbClient } from '../../lib/db.js';
import type { AppUser } from './user.types.js';

function mapUserRow(row: Record<string, unknown>): AppUser {
  return {
    id: String(row.id),
    authSubject: String(row.auth_subject),
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
        SELECT id, auth_subject, email, created_at, updated_at, last_seen_at
        FROM app_users
        WHERE id = $1::uuid
      `,
      [userId],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async findByAuthSubject(client: DbClient, authSubject: string): Promise<AppUser | null> {
    const result = await client.query(
      `
        SELECT id, auth_subject, email, created_at, updated_at, last_seen_at
        FROM app_users
        WHERE auth_subject = $1
      `,
      [authSubject],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async upsertFromAuthSubject(client: DbClient, params: { authSubject: string; email: string | null }): Promise<AppUser> {
    const result = await client.query(
      `
        INSERT INTO app_users (auth_subject, email)
        VALUES ($1, $2)
        ON CONFLICT (auth_subject)
        DO UPDATE SET
          email = EXCLUDED.email,
          updated_at = now(),
          last_seen_at = now()
        RETURNING id, auth_subject, email, created_at, updated_at, last_seen_at
      `,
      [params.authSubject, params.email],
    );
    return mapUserRow(result.rows[0]);
  }

  async deleteById(client: DbClient, userId: string): Promise<boolean> {
    const result = await client.query(
      `
        DELETE FROM app_users
        WHERE id = $1::uuid
        RETURNING id
      `,
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
