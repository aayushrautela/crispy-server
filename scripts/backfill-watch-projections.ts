import { db } from '../src/lib/db.js';
import { logger } from '../src/config/logger.js';
import { redis } from '../src/lib/redis.js';
import { calendarCacheKey } from '../src/modules/cache/cache-keys.js';
import { ProfileRepository } from '../src/modules/profiles/profile.repo.js';
import { WatchV2ProjectionRebuildService } from '../src/modules/watch-v2/watch-v2-projection-rebuild.service.js';

const PAGE_SIZE = 100;

async function main(): Promise<void> {
  const profileRepository = new ProfileRepository();
  const projectionRebuildService = new WatchV2ProjectionRebuildService();
  const client = await db.connect();

  let offset = 0;
  let rebuiltProfiles = 0;

  try {
    while (true) {
      const profiles = await profileRepository.listAll(client, PAGE_SIZE, offset);
      if (profiles.length === 0) {
        break;
      }

      for (const profile of profiles) {
        await client.query('BEGIN');
        try {
          const summary = await projectionRebuildService.rebuildProfile(client, profile.id);
          await client.query('COMMIT');
          await redis.del(calendarCacheKey(profile.id));
          rebuiltProfiles += 1;
          logger.info({ profileId: profile.id, summary }, 'rebuilt watch projections');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      offset += profiles.length;
    }

    logger.info({ rebuiltProfiles }, 'completed watch projection backfill');
  } finally {
    client.release();
    await db.end();
  }
}

void main();
