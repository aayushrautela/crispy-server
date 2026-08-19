import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { HttpError } from '../../lib/errors.js';
import type { AppUser } from './user.types.js';

const ACTIVE_WHERE = 'deleted_at IS NULL';
const BASE_SELECT = 'id, email, created_at, updated_at, last_seen_at';

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

function rowOrNull(row: Record<string, unknown> | undefined): AppUser | null {
  return row ? mapUserRow(row) : null;
}

export class UserRepository {
  async findById(client: DbClient, userId: string): Promise<AppUser | null> {
    const result = await client.query(
      `SELECT ${BASE_SELECT}
       FROM identity.accounts
       WHERE id = $1::uuid AND ${ACTIVE_WHERE}`,
      [userId],
    );
    return rowOrNull(result.rows[0]);
  }

  async listByEmail(client: DbClient, email: string): Promise<AppUser[]> {
    const normalizedEmail = email.trim();
    const result = await client.query(
      `SELECT ${BASE_SELECT}
       FROM identity.accounts
       WHERE lower(email) = lower($1) AND ${ACTIVE_WHERE}
       ORDER BY last_seen_at DESC, updated_at DESC, created_at DESC`,
      [normalizedEmail],
    );
    return result.rows.map((row) => mapUserRow(row));
  }

  async findByAuthSubject(client: DbClient, authSubject: string): Promise<AppUser | null> {
    const result = await client.query(
      `SELECT ${BASE_SELECT}
       FROM identity.accounts
       WHERE id = $1::uuid AND ${ACTIVE_WHERE}`,
      [authSubject],
    );
    return rowOrNull(result.rows[0]);
  }

  async findAuthUserByEmail(
    client: DbClient,
    email: string,
  ): Promise<{ authSubject: string; email: string | null } | null> {
    const result = await client.query(
      `SELECT id, email
       FROM auth.users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email.trim()],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      authSubject: String(row.id),
      email: typeof row.email === 'string' ? row.email : null,
    };
  }

  async upsertFromAuthSubject(client: DbClient, params: { authSubject: string; email: string | null }): Promise<AppUser> {
    await client.query(
      `SELECT identity.upsert_account($1::uuid, $2, $3)`,
      [params.authSubject, params.email, null],
    );
    const result = await client.query(
      `SELECT ${BASE_SELECT}
       FROM identity.accounts
       WHERE id = $1::uuid AND ${ACTIVE_WHERE}`,
      [params.authSubject],
    );
    if (!result.rows[0]) {
      throw new HttpError(500, 'Account row not found after upsert. The account may be soft-deleted or the upsert function did not create a row.');
    }
    return mapUserRow(result.rows[0]);
  }

  async deleteById(client: DbClient, userId: string): Promise<boolean> {
    const result = await client.query(
      `DELETE FROM identity.accounts
       WHERE id = $1::uuid AND ${ACTIVE_WHERE}
       RETURNING id`,
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
