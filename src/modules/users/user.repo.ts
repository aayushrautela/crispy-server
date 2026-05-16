import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import type { AppUser } from './user.types.js';

function mapUserRow(row: Record<string, unknown>): AppUser {
  return {
    id: String(row.id),
    authSubject: String(row.id),
    email: typeof row.email === 'string' ? row.email : null,
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'identity.accounts.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'identity.accounts.updated_at'),
    lastSeenAt: requireDbIsoString(row.last_seen_at as Date | string | null | undefined, 'identity.accounts.last_seen_at'),
  };
}

export class UserRepository {
  async findById(client: DbClient, userId: string): Promise<AppUser | null> {
    const result = await client.query(
      `
        SELECT id, email, created_at, updated_at, last_seen_at
        FROM identity.accounts
        WHERE id = $1::uuid
      `,
      [userId],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async listByEmail(client: DbClient, email: string): Promise<AppUser[]> {
    const normalizedEmail = email.trim();
    const result = await client.query(
      `
        SELECT id, email, created_at, updated_at, last_seen_at
        FROM identity.accounts
        WHERE lower(email) = lower($1)
        ORDER BY last_seen_at DESC, updated_at DESC, created_at DESC
      `,
      [normalizedEmail],
    );
    return result.rows.map((row) => mapUserRow(row));
  }

  async findByAuthSubject(client: DbClient, authSubject: string): Promise<AppUser | null> {
    const result = await client.query(
      `
        SELECT id, email, created_at, updated_at, last_seen_at
        FROM identity.accounts
        WHERE id = $1::uuid
      `,
      [authSubject],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  async upsertFromAuthSubject(client: DbClient, params: { authSubject: string; email: string | null }): Promise<AppUser> {
    const result = await client.query(
      `
        SELECT id, email, created_at, updated_at, last_seen_at
        FROM identity.upsert_account($1::uuid, $2, $3)
      `,
      [params.authSubject, params.email, null],
    );
    return mapUserRow(result.rows[0]);
  }

  async deleteById(client: DbClient, userId: string): Promise<boolean> {
    const result = await client.query(
      `
        DELETE FROM identity.accounts
        WHERE id = $1::uuid
        RETURNING id
      `,
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
