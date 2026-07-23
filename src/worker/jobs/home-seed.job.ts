import { FallbackBuilderService } from '../../modules/home/fallback/index.js';
import type { HomeSeedJob } from '../../lib/queue.js';

/**
 * Seeds a profile's `fallback` home by delegating to the in-process
 * `FallbackBuilderService`, which owns template resolution, list-source
 * fetching, empty-rail dropping, and persistence via the home ingester.
 * Runs asynchronously after signup so the first home read sees a
 * deterministic floor instead of an empty screen.
 */
export async function runHomeSeedJob(job: HomeSeedJob): Promise<void> {
  const builder = new FallbackBuilderService();
  await builder.buildForProfile(job.accountId, job.profileId);
}
