import { withTransaction, type DbClient } from '../../lib/db.js';
import {
  ProviderAccountsRepository,
  type ProviderAccountAdminRecord,
} from './provider-accounts.repo.js';
import {
  ProviderImportJobsRepository,
  type ProviderImportJobAdminRecord,
} from './provider-import-jobs.repo.js';
import type { ProviderAccountStatus, ProviderImportJobStatus, ProviderImportProvider } from './provider-import.types.js';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class ProviderAdminService {
  constructor(
    private readonly providerAccountsRepository = new ProviderAccountsRepository(),
    private readonly jobsRepository = new ProviderImportJobsRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async listConnections(filters?: {
    provider?: ProviderImportProvider | null;
    status?: ProviderAccountStatus | null;
    expiringWithinHours?: number | null;
    refreshFailuresOnly?: boolean;
    limit?: number;
  }): Promise<{ connections: ProviderAccountAdminRecord[] }> {
    const expiringBefore = filters?.expiringWithinHours && filters.expiringWithinHours > 0
      ? new Date(Date.now() + filters.expiringWithinHours * 60 * 60 * 1000).toISOString()
      : null;

    return this.runInTransaction(async (client) => ({
      connections: await this.providerAccountsRepository.listAdminProviderAccounts(client, {
        provider: filters?.provider ?? null,
        status: filters?.status ?? null,
        expiringBefore,
        refreshFailuresOnly: filters?.refreshFailuresOnly ?? false,
        limit: filters?.limit ?? 100,
      }),
    }));
  }

  async listJobs(filters?: {
    provider?: ProviderImportProvider | null;
    status?: ProviderImportJobStatus | null;
    failuresOnly?: boolean;
    limit?: number;
  }): Promise<{ jobs: ProviderImportJobAdminRecord[] }> {
    return this.runInTransaction(async (client) => ({
      jobs: await this.jobsRepository.listAdminJobs(client, {
        provider: filters?.provider ?? null,
        status: filters?.status ?? null,
        failuresOnly: filters?.failuresOnly ?? false,
        limit: filters?.limit ?? 100,
      }),
    }));
  }
}
