import { randomUUID } from 'node:crypto';
import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { enqueueProviderImport } from '../../lib/queue.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import {
  ProviderImportConnectionsRepository,
  type ProviderImportConnectionRecord,
} from './provider-import-connections.repo.js';
import { ProviderImportJobsRepository, type ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import { ProfileWatchDataStateRepository, type ProfileWatchDataStateRecord } from './profile-watch-data-state.repo.js';
import { isProviderImportProvider, type ProviderImportProvider } from './provider-import.types.js';

export type StartedProviderImport = {
  job: ProviderImportJobRecord;
  connection: ProviderImportConnectionRecord | null;
  watchDataState: ProfileWatchDataStateRecord;
  authUrl: string | null;
  nextAction: 'authorize_provider' | 'queued';
};

export class ProviderImportService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly connectionsRepository = new ProviderImportConnectionsRepository(),
    private readonly jobsRepository = new ProviderImportJobsRepository(),
    private readonly watchDataStateRepository = new ProfileWatchDataStateRepository(),
  ) {}

  async startReplaceImport(userId: string, profileId: string, provider: ProviderImportProvider): Promise<StartedProviderImport> {
    const started = await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const watchDataState = await this.watchDataStateRepository.ensure(client, profileId);
      const connectedConnection = await this.connectionsRepository.findLatestConnectedForProfile(client, profileId, provider);

      if (connectedConnection) {
        const queuedJob = await this.jobsRepository.create(client, {
          profileId,
          householdId: profile.householdId,
          provider,
          requestedByUserId: userId,
          connectionId: connectedConnection.id,
          status: 'queued',
        });

        return {
          job: queuedJob,
          connection: connectedConnection,
          watchDataState,
          authUrl: null,
          nextAction: 'queued' as const,
        };
      }

      const connection = await this.connectionsRepository.createPending(client, {
        profileId,
        provider,
        createdByUserId: userId,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

      const pendingJob = await this.jobsRepository.create(client, {
        profileId,
        householdId: profile.householdId,
        provider,
        requestedByUserId: userId,
        connectionId: connection.id,
        status: 'oauth_pending',
      });

      return {
        job: pendingJob,
        connection,
        watchDataState,
        authUrl: this.buildAuthUrl(provider, connection.stateToken),
        nextAction: 'authorize_provider' as const,
      };
    });

    if (started.nextAction === 'queued') {
      await enqueueProviderImport(profileId, started.job.id);
    }

    return started;
  }

  async listJobs(userId: string, profileId: string): Promise<{ jobs: ProviderImportJobRecord[]; watchDataState: ProfileWatchDataStateRecord | null }> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const [jobs, watchDataState] = await Promise.all([
        this.jobsRepository.listForProfile(client, profileId),
        this.watchDataStateRepository.getForProfile(client, profileId),
      ]);

      return { jobs, watchDataState };
    });
  }

  async getJob(userId: string, profileId: string, jobId: string): Promise<ProviderImportJobRecord> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const job = await this.jobsRepository.findByIdForProfile(client, profileId, jobId);
      if (!job) {
        throw new HttpError(404, 'Import job not found.');
      }

      return job;
    });
  }

  async runQueuedImport(jobId: string): Promise<void> {
    await withTransaction(async (client) => {
      const job = await this.jobsRepository.findById(client, jobId);
      if (!job) {
        throw new HttpError(404, 'Import job not found.');
      }

      if (job.status !== 'queued') {
        return;
      }

      await this.jobsRepository.markRunning(client, jobId);
      await this.jobsRepository.markFailed(client, jobId, {
        code: 'provider_import_not_implemented',
        message: 'Provider fetch and replace execution is not implemented yet.',
        retryable: false,
        requestId: randomUUID(),
      });
    });
  }

  private buildAuthUrl(provider: ProviderImportProvider, stateToken: string | null): string | null {
    if (!stateToken) {
      return null;
    }

    if (provider === 'trakt' && env.traktImportClientId && env.traktImportRedirectUri) {
      const url = new URL('https://api.trakt.tv/oauth/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', env.traktImportClientId);
      url.searchParams.set('redirect_uri', env.traktImportRedirectUri);
      url.searchParams.set('state', stateToken);
      return url.toString();
    }

    if (provider === 'simkl' && env.simklImportClientId && env.simklImportRedirectUri) {
      const url = new URL('https://simkl.com/oauth/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', env.simklImportClientId);
      url.searchParams.set('redirect_uri', env.simklImportRedirectUri);
      url.searchParams.set('state', stateToken);
      return url.toString();
    }

    return null;
  }
}

export function parseImportProvider(value: unknown): ProviderImportProvider {
  if (!isProviderImportProvider(value)) {
    throw new HttpError(400, 'Provider must be either trakt or simkl.');
  }
  return value;
}
