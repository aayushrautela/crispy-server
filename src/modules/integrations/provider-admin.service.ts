import { withTransaction, type DbClient } from '../../lib/db.js';
import { ProviderSessionsRepository, type ProviderSessionRecord } from './provider-sessions.repo.js';
import {
  ProviderImportJobsRepository,
  type ProviderImportJobAdminRecord,
} from './provider-import-jobs.repo.js';
import type { ProviderImportJobStatus, ProviderImportProvider } from './provider-import.types.js';
import { ProviderTokenRefreshService } from './provider-token-refresh.service.js';

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export type ProviderSessionAdminRecord = {
  profileId: string;
  provider: ProviderImportProvider;
  state: string;
  providerUserId: string | null;
  externalUsername: string | null;
  accessTokenExpiresAt: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  recommendedRefreshDelayMs: number | null;
  lastImportCompletedAt: string | null;
  connected: boolean;
  updatedAt: string;
};

export class ProviderAdminService {
  constructor(
    private readonly providerSessionsRepository = new ProviderSessionsRepository(),
    private readonly jobsRepository = new ProviderImportJobsRepository(),
    private readonly tokenRefreshService = new ProviderTokenRefreshService(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async listConnections(filters?: {
    provider?: ProviderImportProvider | null;
    expiringWithinHours?: number | null;
    refreshFailuresOnly?: boolean;
    limit?: number;
  }): Promise<{ connections: ProviderSessionAdminRecord[] }> {
    const expiringBeforeMs = filters?.expiringWithinHours && filters.expiringWithinHours > 0
      ? Date.now() + filters.expiringWithinHours * 60 * 60 * 1000
      : null;

    return this.runInTransaction(async (client) => {
      const connections = await this.providerSessionsRepository.listAll(client, {
        provider: filters?.provider ?? null,
        limit: filters?.limit ?? 100,
      });

      const filtered = connections.filter((session) => {
        if (filters?.refreshFailuresOnly && !session.lastRefreshError) {
          return false;
        }

        if (expiringBeforeMs !== null) {
          const accessTokenExpiresAt = asTimestamp(session.credentialsJson.accessTokenExpiresAt);
          if (accessTokenExpiresAt === null || accessTokenExpiresAt > expiringBeforeMs) {
            return false;
          }
        }

        return true;
      });

      return {
        connections: filtered.map((session) => mapProviderSessionAdminRecord(session, this.tokenRefreshService)),
      };
    });
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

function mapProviderSessionAdminRecord(
  session: ProviderSessionRecord,
  tokenRefreshService: ProviderTokenRefreshService,
): ProviderSessionAdminRecord {
  return {
    profileId: session.profileId,
    provider: session.provider,
    state: session.state,
    providerUserId: session.providerUserId,
    externalUsername: session.externalUsername,
    accessTokenExpiresAt: asIsoString(session.credentialsJson.accessTokenExpiresAt),
    hasAccessToken: asString(session.credentialsJson.accessToken) !== null,
    hasRefreshToken: asString(session.credentialsJson.refreshToken) !== null,
    lastRefreshAt: session.lastRefreshAt,
    lastRefreshError: session.lastRefreshError,
    recommendedRefreshDelayMs: tokenRefreshService.getRecommendedDelayMs(session),
    lastImportCompletedAt: session.lastImportCompletedAt,
    connected: session.state === 'connected',
    updatedAt: session.updatedAt,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asIsoString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const normalized = new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized.toISOString();
}

function asTimestamp(value: unknown): number | null {
  const iso = asIsoString(value);
  if (!iso) {
    return null;
  }
  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? null : timestamp;
}
