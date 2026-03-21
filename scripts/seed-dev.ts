import { db } from '../src/lib/db.js';
import { logger } from '../src/config/logger.js';

async function main(): Promise<void> {
  const result = await db.query('SELECT count(*)::int AS profile_count FROM profiles');
  logger.info({ profileCount: result.rows[0]?.profile_count ?? 0 }, 'dev seed placeholder');
  await db.end();
}

void main();
