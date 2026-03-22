import { logger } from '../../config/logger.js';
import type { ProjectionRefreshJob } from '../../lib/queue.js';
import { ProviderImportService } from '../../modules/imports/provider-import.service.js';

export async function runProviderImportJob(job: ProjectionRefreshJob): Promise<void> {
  if (!job.importJobId) {
    throw new Error('provider-import job missing importJobId');
  }

  const importService = new ProviderImportService();
  await importService.runQueuedImport(job.importJobId);
  logger.info({ job }, 'provider import job processed');
}
