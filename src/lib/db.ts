import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export const db = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
});

export type DbClient = pg.PoolClient;

export async function withDbClient<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  return withDbClient(async (client) => {
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
