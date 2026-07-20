import { db } from '../src/lib/db.js';
import { enqueueHomeSeed } from '../src/lib/queue.js';
import { logger } from '../src/config/logger.js';

const PAGE_SIZE = 500;

async function main(): Promise<void> {
  let offset = 0;
  let totalEnqueued = 0;

  while (true) {
    const result = await db.query<{ id: string; account_id: string }>(`
      SELECT id, account_id
        FROM identity.profiles
        WHERE deleted_at IS NULL
        ORDER BY id
        LIMIT $1::int OFFSET $2::int
    `, [PAGE_SIZE, offset]);

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      try {
        await enqueueHomeSeed({ accountId: row.account_id, profileId: row.id });
        totalEnqueued++;
      } catch (err) {
        logger.warn({ err, profileId: row.id }, 'reseed-all-profiles: enqueue failed');
      }
    }

    offset += result.rows.length;
    if (result.rows.length < PAGE_SIZE) break;
  }

  logger.info({ totalEnqueued }, 'reseed-all-profiles: enqueued home-seed for every active profile');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'reseed-all-profiles: fatal');
    process.exit(1);
  });
