import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/lib/db.js';
import { logger } from '../src/config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function resolveMigrationsDir(): Promise<string> {
  const candidates = [
    path.resolve(__dirname, '../migrations'),
    path.resolve(__dirname, '../../migrations'),
  ];

  for (const candidate of candidates) {
    try {
      const entries = await readdir(candidate);
      if (entries.some((name) => name.endsWith('.sql'))) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Could not locate migrations directory from ${__dirname}`);
}

async function main(): Promise<void> {
  const migrationsDir = await resolveMigrationsDir();
  const client = await db.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.version));
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'applied migration');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

void main();
