import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db, withDbClient, withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { enqueueProviderImport, enqueueProviderRefresh, enqueueTmdbTitleWarmBatch } from '../../lib/queue.js';
import { logger } from '../../config/logger.js';
import { redis } from '../../lib/redis.js';
import { calendarCacheKey } from '../cache/cache-keys.js';
import { TmdbExternalIdResolverService } from '../metadata/providers/tmdb-external-id-resolver.service.js';
import { MetadataRefreshService } from '../metadata/metadata-refresh.service.js';
import { inferMediaIdentity, canonicalTitleMediaKey, canonicalTitleMediaType, type MediaIdentity } from '../identity/media-key.js';
import type { ProfileRecord } from '../profiles/profile.repo.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { ProviderImportJobsRepository, type ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import { ProfileWatchDataStateRepository, type ProfileWatchDataStateRecord } from './profile-watch-data-state.repo.js';
import { isProviderImportProvider, providerLabel, type ProviderImportProvider } from './provider-import.types.js';
import { mapProviderSessionStateView, type ProviderStateView } from './provider-import.views.js';
import {
  ProviderSessionsRepository,
  type ProviderSessionRecord,
} from './provider-sessions.repo.js';
import { ProviderTokenRefreshService } from './provider-token-refresh.service.js';
import { type ValidatedImportReturnTo } from './provider-import-return-to.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { UserRepository } from '../users/user.repo.js';
import {
  LocalProviderHistoryWriter,
  type ImportedProviderHistoryEntry,
  type ImportedProviderListItem,
  type ImportedProviderPlaybackState,
  type ImportedProviderRating,
  type LocalProviderImportSyncResult,
} from './local-provider-history-writer.js';
import type {
  ImportedWatchEventDraft,
  ProviderImportModule,
  ProviderProfileResult,
  ProviderReplaceImportPayload,
  ProviderTokenExchangeResult,
  ResolvedImportIdentity,
  TransactionRunner,
} from './provider-import.internals.js';
import {
  asIsoString,
  asString,
  buildConnectedSessionCredentials,
  clampProgressBps,
  isRecord,
  nonNegativeIntegerOrNull,
  positiveIntegerOrNull,
  progressBpsFromPosition,
  sanitizeDisconnectedCredentials,
  sanitizeReauthSessionCredentials,
} from './provider-import.utils.js';
import { TraktImportService } from './trakt/trakt-import.service.js';
import { SimklImportService } from './simkl/simkl-import.service.js';

export type StartedProviderImport = {
  job: ProviderImportJobRecord;
  providerState: ProviderStateView;
  watchDataState: ProviderWatchDataStateView;
  authUrl: string | null;
  nextAction: 'authorize_provider' | 'queued';
};

export type CompletedProviderImportCallback = {
  job: ProviderImportJobRecord;
  providerState: ProviderStateView;
  nextAction: 'queued';
};

export type ProviderSessionActionResult = {
  job: ProviderImportJobRecord | null;
  providerState: ProviderStateView;
  watchDataState: ProviderWatchDataStateView;
  authUrl: string | null;
  nextAction: 'authorize_provider' | 'queued';
};

type ProviderCallbackParams = {
  state: string;
  code?: string;
  error?: string;
  errorDescription?: string;
};

type ProviderWatchDataStateView = {
  profileId: string;
  watchDataUpdatedAt: string;
  watchDataOrigin: 'native' | 'provider_import';
  lastImportCompletedAt: string | null;
};

type ProviderImportFacts = {
  historyEntries: ImportedProviderHistoryEntry[];
  watchlistItems: ImportedProviderListItem[];
  ratings: ImportedProviderRating[];
  playbackStates: ImportedProviderPlaybackState[];
};

function pickProviderSession(
  providerSessions: ProviderSessionRecord[],
  provider: ProviderImportProvider,
): ProviderSessionRecord | null {
  return providerSessions.find((providerSession) => providerSession.provider === provider) ?? null;
}

function mapWatchDataStateView(watchDataState: ProfileWatchDataStateRecord | null): ProviderWatchDataStateView | null {
  if (!watchDataState) {
    return null;
  }
  return {
    profileId: watchDataState.profileId,
    watchDataUpdatedAt: watchDataState.updatedAt,
    watchDataOrigin: watchDataState.currentOrigin,
    lastImportCompletedAt: watchDataState.lastImportCompletedAt,
  };
}

function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function assertProviderEnabled(provider: ProviderImportProvider): void {
  void provider;
}

function buildDefaultLocalProviderHistoryWriter(): LocalProviderHistoryWriter {
  return new LocalProviderHistoryWriter();
}

function buildProviderModuleRegistry(deps: {
  externalIdResolver: TmdbExternalIdResolverService;
  tmdbCacheService: TmdbCacheService;
  metadataCardService: MetadataCardService;
}): Record<ProviderImportProvider, ProviderImportModule> {
  return {
    trakt: new TraktImportService({
      externalIdResolver: deps.externalIdResolver,
      tmdbCacheService: deps.tmdbCacheService,
      metadataCardService: deps.metadataCardService,
    }),
    simkl: new SimklImportService({
      externalIdResolver: deps.externalIdResolver,
      tmdbCacheService: deps.tmdbCacheService,
      metadataCardService: deps.metadataCardService,
    }),
  };
}

export class ProviderImportService {
  private readonly modules: Record<ProviderImportProvider, ProviderImportModule>;

  constructor(
    private readonly profileService = new ProfileLocalService(),
    private readonly providerSessionsRepository = new ProviderSessionsRepository(),
    private readonly jobsRepository = new ProviderImportJobsRepository(),
    private readonly watchDataStateRepository = new ProfileWatchDataStateRepository(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
    private readonly metadataRefreshService = new MetadataRefreshService(),
    private readonly tokenRefreshService = new ProviderTokenRefreshService(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly metadataCardService = new MetadataCardService(),
    private readonly userRepository = new UserRepository(),
    private readonly localProviderHistoryWriter = buildDefaultLocalProviderHistoryWriter(),
  ) {
    this.modules = buildProviderModuleRegistry({
      externalIdResolver: this.externalIdResolver,
      tmdbCacheService: this.tmdbCacheService,
      metadataCardService: this.metadataCardService,
    });
  }

  private moduleFor(provider: ProviderImportProvider): ProviderImportModule {
    return this.modules[provider];
  }

  async connectProvider(
    userId: string,
    profileId: string,
    provider: ProviderImportProvider,
    importClient?: ValidatedImportReturnTo,
  ): Promise<ProviderSessionActionResult> {
    return this.startProviderAuthorization(userId, profileId, provider, importClient);
  }

  async reconnectProvider(
    userId: string,
    profileId: string,
    provider: ProviderImportProvider,
    importClient?: ValidatedImportReturnTo,
  ): Promise<ProviderSessionActionResult> {
    return this.startProviderAuthorization(userId, profileId, provider, importClient);
  }

  async findPendingOAuthSession(
    provider: ProviderImportProvider,
    stateToken: string,
  ): Promise<ProviderSessionRecord | null> {
    if (!stateToken) return null;
    return withDbClient((client) => this.providerSessionsRepository.findPendingByStateToken(client, provider, stateToken));
  }

  async importProviderNow(
    userId: string,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<ProviderSessionActionResult> {
    assertProviderEnabled(provider);
    const started = await this.runInTransaction(async (client) => {
      await this.profileService.requireOwnedProfile(userId, profileId);

      const watchDataState = await this.watchDataStateRepository.ensure(client, profileId);
      const providerSession = await this.providerSessionsRepository.getConnectedSession(client, profileId, provider);
      if (!providerSession) {
        const providerState = mapProviderSessionStateView(provider, providerSession);
        throw new HttpError(409, `Log in to ${providerLabel(provider)} again to continue importing.`, {
          provider,
          code: providerState.connectionState === 'not_connected' ? 'provider_not_connected' : 'provider_reauth_required',
          providerState,
        });
      }

      const activeProviderSession = await this.ensureImportableSessionAccount(client, providerSession);
      const queuedJob = await this.jobsRepository.create(client, {
        profileId,
        profileGroupId: null,
        provider,
        requestedByUserId: userId,
        status: 'queued',
      });

      return {
        job: queuedJob,
        providerState: mapProviderSessionStateView(provider, activeProviderSession),
        watchDataState: mapWatchDataStateView(watchDataState) as ProviderWatchDataStateView,
        authUrl: null,
        nextAction: 'queued' as const,
      };
    });

    if (started.job) {
      await enqueueProviderImport(profileId, started.job.id);
    }

    return started;
  }

  async listProviderSessions(
    userId: string,
    profileId: string,
  ): Promise<{ providerStates: ProviderStateView[]; watchDataState: ProviderWatchDataStateView | null }> {
    return this.runInTransaction(async (client) => {
      await this.profileService.requireOwnedProfile(userId, profileId);

      const [providerSessions, watchDataState] = await Promise.all([
        this.providerSessionsRepository.listForProfile(client, profileId),
        this.watchDataStateRepository.getForProfile(client, profileId),
      ]);

      return {
        providerStates: [
          mapProviderSessionStateView('trakt', pickProviderSession(providerSessions, 'trakt')),
          mapProviderSessionStateView('simkl', pickProviderSession(providerSessions, 'simkl')),
        ],
        watchDataState: mapWatchDataStateView(watchDataState),
      };
    });
  }

  async disconnectProviderSession(
    userId: string,
    profileId: string,
    provider: ProviderImportProvider,
  ): Promise<{ providerState: ProviderStateView }> {
    assertProviderEnabled(provider);

    const providerSession = await this.runInTransaction(async (client) => {
      await this.profileService.requireOwnedProfile(userId, profileId);
      return this.providerSessionsRepository.findByProfileAndProvider(client, profileId, provider);
    });

    if (providerSession) {
      try {
        await this.moduleFor(provider).revokeAuthorization(providerSession.credentialsJson);
      } catch (error) {
        logger.warn({ error, provider }, 'provider revoke failed during disconnect');
      }
    }

    const disconnected = await this.runInTransaction(async (client) => {
      const disconnectedAt = new Date().toISOString();
      return this.providerSessionsRepository.markDisconnected(client, {
        profileId,
        provider,
        disconnectedAt,
      });
    });

    return { providerState: mapProviderSessionStateView(provider, disconnected) };
  }

  async completeOAuthCallback(
    provider: ProviderImportProvider,
    params: ProviderCallbackParams,
  ): Promise<CompletedProviderImportCallback> {
    assertProviderEnabled(provider);
    const completed = await this.runInTransaction(async (client) => {
      const providerSession = await this.providerSessionsRepository.findPendingByStateToken(client, provider, params.state);
      if (!providerSession) {
        throw new HttpError(404, 'Provider import connection not found for callback state.');
      }

      const pendingJob = await this.jobsRepository.findLatestOauthPendingForProfileProvider(client, providerSession.profileId, provider);
      if (!pendingJob) {
        throw new HttpError(404, 'Provider import job not found for callback state.');
      }

      const now = Date.now();
      if (providerSession.expiresAt && Date.parse(providerSession.expiresAt) < now) {
        await this.providerSessionsRepository.clearOAuthPending(client, {
          profileId: providerSession.profileId,
          provider,
          finalState: 'not_connected',
        });
        await this.jobsRepository.markFailed(client, pendingJob.id, {
          code: 'provider_oauth_expired',
          message: 'Provider authorization expired before callback completion.',
          retryable: true,
        });
        throw new HttpError(410, 'Provider authorization has expired. Start the import again.');
      }

      if (params.error) {
        await this.providerSessionsRepository.clearOAuthPending(client, {
          profileId: providerSession.profileId,
          provider,
          finalState: 'not_connected',
        });
        await this.jobsRepository.markFailed(client, pendingJob.id, {
          code: 'provider_oauth_denied',
          message: params.errorDescription ?? params.error,
          provider,
          retryable: true,
        });
        throw new HttpError(400, params.errorDescription ?? params.error);
      }

      const code = params.code?.trim();
      if (!code) {
        throw new HttpError(400, 'Missing provider authorization code.');
      }

      const codeVerifier = typeof providerSession.credentialsJson.pkceCodeVerifier === 'string'
        ? providerSession.credentialsJson.pkceCodeVerifier
        : '';
      if (!codeVerifier) {
        throw new HttpError(400, 'Missing stored PKCE verifier for provider callback.');
      }

      const module = this.moduleFor(provider);
      const exchanged = await module.exchangeAuthorizationCode(code, codeVerifier);
      const profile = await module.fetchProfile(exchanged.accessToken);
      const connectedAt = new Date().toISOString();

      const connectedSession = await this.providerSessionsRepository.markConnected(client, {
        profileId: providerSession.profileId,
        provider,
        providerUserId: profile.providerUserId,
        externalUsername: profile.externalUsername,
        connectedAt,
        credentialsJson: buildConnectedSessionCredentials({
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken,
          accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
          connectedAt,
          lastRefreshAt: connectedAt,
          lastRefreshError: null,
          tokenPayload: exchanged.raw,
        }),
      });

      await this.jobsRepository.markQueued(client, pendingJob.id, {
        summaryJson: {
          oauthCompletedAt: connectedAt,
          providerUserId: profile.providerUserId,
          externalUsername: profile.externalUsername,
        },
      });
      const queuedJob = await this.jobsRepository.findById(client, pendingJob.id);
      if (!queuedJob) {
        throw new HttpError(404, 'Provider import job disappeared during callback completion.');
      }

      return {
        job: queuedJob,
        providerState: mapProviderSessionStateView(provider, connectedSession),
        nextAction: 'queued' as const,
      };
    });

    await enqueueProviderImport(completed.job.profileId, completed.job.id);
    await this.scheduleProviderRefresh(completed.job.profileId, provider);
    return completed;
  }

  async listJobs(userId: string, profileId: string): Promise<{ jobs: ProviderImportJobRecord[]; watchDataState: ProfileWatchDataStateRecord | null }> {
    return this.runInTransaction(async (client) => {
      await this.profileService.requireOwnedProfile(userId, profileId);
      const [jobs, watchDataState] = await Promise.all([
        this.jobsRepository.listForProfile(client, profileId),
        this.watchDataStateRepository.getForProfile(client, profileId),
      ]);
      return { jobs, watchDataState };
    });
  }

  async getJob(userId: string, profileId: string, jobId: string): Promise<ProviderImportJobRecord> {
    return this.runInTransaction(async (client) => {
      await this.profileService.requireOwnedProfile(userId, profileId);
      const job = await this.jobsRepository.findByIdForProfile(client, profileId, jobId);
      if (!job) {
        throw new HttpError(404, 'Import job not found.');
      }
      return job;
    });
  }

  async runQueuedImport(jobId: string): Promise<void> {
    const requestId = randomUUID();

    const runningJob = await this.runInTransaction(async (client) => {
      const job = await this.jobsRepository.findById(client, jobId);
      if (!job) {
        throw new HttpError(404, 'Import job not found.');
      }
      if (job.status !== 'queued') {
        return null;
      }
      await this.jobsRepository.markRunning(client, jobId);
      return this.jobsRepository.findById(client, jobId);
    });

    if (!runningJob) {
      return;
    }

    try {
      const activeProviderSession = await this.runInTransaction(async (client) => {
        const providerSession = await this.providerSessionsRepository.getConnectedSession(client, runningJob.profileId, runningJob.provider);
        if (!providerSession) {
          throw new HttpError(400, 'Queued provider import does not have a connected provider session.');
        }
        return (await this.tokenRefreshService.refreshConnectedSession(providerSession)).providerSession;
      });

      const importedPayload = await this.moduleFor(runningJob.provider).fetchAndNormalizeImport(runningJob, activeProviderSession.credentialsJson);

      const watchDataState = await this.runInTransaction((client) => this.watchDataStateRepository.markResetForImport(client, {
        profileId: runningJob.profileId,
        provider: runningJob.provider,
        importJobId: runningJob.id,
        resetAt: importedPayload.importedAt,
      }));
      const historyGeneration = watchDataState.historyGeneration;

      const interactionSummary = await this.syncProviderInteractionsToLocal({
        job: runningJob,
        providerSession: activeProviderSession,
        historyGeneration,
        importedAt: importedPayload.importedAt,
        payload: importedPayload,
      });

      const warnings: string[] = [...interactionSummary.warnings];
      let metadataSummary: Record<string, unknown> = {
        refreshedTitles: 0,
        refreshedSeasons: 0,
        refreshedTrackedShows: 0,
        skipped: 0,
        failures: 0,
      };

      try {
        metadataSummary = await this.refreshImportedMetadata(runningJob.profileId, importedPayload.mediaKeysToRefresh ?? []);
        if (Number(metadataSummary.failures ?? 0) > 0) {
          warnings.push(`metadata refresh failures: ${String(metadataSummary.failures)}`);
        }
      } catch (error) {
        warnings.push(`failed to refresh metadata: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      try {
        await this.markProviderSessionImportComplete(activeProviderSession, runningJob.id, importedPayload.importedAt);
      } catch (error) {
        warnings.push(`failed to update provider connection usage: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      try {
        await this.runInTransaction((client) => this.watchDataStateRepository.markImportCompleted(client, {
          profileId: runningJob.profileId,
          provider: runningJob.provider,
          importJobId: runningJob.id,
          completedAt: importedPayload.importedAt,
        }));
      } catch (error) {
        warnings.push(`failed to mark watch data state import completed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      try {
        await this.scheduleProviderRefresh(activeProviderSession.profileId, activeProviderSession.provider);
      } catch (error) {
        warnings.push(`failed to schedule provider refresh: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      try {
        await redis.del(calendarCacheKey(runningJob.profileId));
      } catch (error) {
        warnings.push(`failed to invalidate caches: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      await this.runInTransaction(async (client) => {
        const payload = {
          checkpointJson: { phase: 'completed', requestId, warnings },
          summaryJson: {
            ...importedPayload.importSummary,
            insertedEvents: 0,
            insertedHistoryEntries: 0,
            projectionSummary: { titleProjections: 0, trackedTitleStates: 0 },
            metadataSummary,
            interactionSummary,
            historyGeneration,
            warnings,
          },
        };

        if (warnings.length > 0) {
          await this.jobsRepository.markSucceededWithWarnings(client, runningJob.id, payload);
          return;
        }
        await this.jobsRepository.markSucceeded(client, runningJob.id, payload);
      });

      logger.info({
        importJobId: runningJob.id,
        profileId: runningJob.profileId,
        provider: runningJob.provider,
        metadataSummary,
        interactionSummary,
        insertedEvents: 0,
        insertedHistoryEntries: 0,
        warnings,
      }, 'provider replace import completed');
    } catch (error) {
      await this.runInTransaction(async (client) => {
        await this.jobsRepository.markFailed(client, runningJob.id, {
          code: error instanceof HttpError && error.statusCode === 503
            ? 'provider_import_not_implemented'
            : 'provider_import_failed',
          message: error instanceof Error ? error.message : 'Provider import failed.',
          ...(error instanceof HttpError && error.details !== undefined ? { details: error.details } : {}),
          retryable: false,
          requestId,
        });
      });
      throw error;
    }
  }

  private async ensureImportableSessionAccount(
    _client: DbClient,
    providerSession: ProviderSessionRecord,
  ): Promise<ProviderSessionRecord> {
    return (await this.tokenRefreshService.refreshConnectedSession(providerSession as never, { force: true })).providerSession;
  }

  private async startProviderAuthorization(
    userId: string,
    profileId: string,
    provider: ProviderImportProvider,
    importClient?: ValidatedImportReturnTo,
  ): Promise<ProviderSessionActionResult> {
    assertProviderEnabled(provider);
    const started = await this.runInTransaction(async (client) => {
      await this.profileService.requireOwnedProfile(userId, profileId);

      const watchDataState = await this.watchDataStateRepository.ensure(client, profileId);
      const currentSession = await this.providerSessionsRepository.findByProfileAndProvider(client, profileId, provider);
      const stateToken = randomUUID();
      const pkce = generatePkcePair();
      const authUrl = this.moduleFor(provider).buildAuthUrl(stateToken, pkce.codeChallenge);
      if (!authUrl) {
        throw new HttpError(503, `Provider import is not configured for ${provider}.`);
      }

      if (currentSession) {
        try {
          await this.moduleFor(provider).revokeAuthorization(currentSession.credentialsJson);
        } catch (error) {
          logger.warn({ error, provider }, 'provider revoke failed during re-auth');
        }
      }
      const providerSession = await this.providerSessionsRepository.upsertPending(client, {
        profileId,
        provider,
        stateToken,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        credentialsJson: {
          pkceCodeVerifier: pkce.codeVerifier,
          pkceCodeChallenge: pkce.codeChallenge,
        },
        oauthReturnTo: importClient ? `${importClient.clientId}|${importClient.baseUrl}` : null,
      });
      const pendingJob = await this.jobsRepository.create(client, {
        profileId,
        profileGroupId: null,
        provider,
        requestedByUserId: userId,
        status: 'oauth_pending',
      });

      return {
        job: pendingJob,
        providerState: mapProviderSessionStateView(provider, providerSession),
        watchDataState: mapWatchDataStateView(watchDataState) as ProviderWatchDataStateView,
        authUrl,
        nextAction: 'authorize_provider' as const,
      };
    });

    return started;
  }

  private async markProviderSessionImportComplete(
    providerSession: ProviderSessionRecord,
    importJobId: string,
    importedAt: string,
  ): Promise<void> {
    const client = await db.connect();
    try {
      await this.providerSessionsRepository.touchImportCompleted(client, {
        profileId: providerSession.profileId,
        provider: providerSession.provider,
        completedAt: importedAt,
        importJobId,
      });
    } finally {
      client.release();
    }
  }

  private async scheduleProviderRefresh(profileId: string, provider: ProviderImportProvider): Promise<void> {
    const providerSession = await this.runInTransaction(async (client) => {
      return this.providerSessionsRepository.getConnectedSession(client, profileId, provider);
    });
    if (!providerSession) {
      return;
    }
    const delayMs = this.tokenRefreshService.getRecommendedDelayMs(providerSession);
    if (delayMs === null) {
      return;
    }
    await enqueueProviderRefresh(profileId, provider, delayMs);
  }

  private async refreshImportedMetadata(profileId: string, mediaKeys: string[]): Promise<Record<string, unknown>> {
    const client = await db.connect();
    try {
      const movieIds = new Set<number>();
      const showIds = new Set<number>();

      for (const mediaKey of mediaKeys) {
        const normalized = mediaKey.trim();
        if (!normalized) {
          continue;
        }
        try {
          const identity = inferMediaIdentity({ mediaKey: normalized, mediaType: normalized.split(':')[0] ?? '' });
          if (identity.mediaType === 'movie' && identity.tmdbId) {
            movieIds.add(identity.tmdbId);
          } else if (identity.mediaType === 'show' && identity.tmdbId) {
            showIds.add(identity.tmdbId);
          }
        } catch {
          continue;
        }
      }

      if (movieIds.size > 0) {
        await enqueueTmdbTitleWarmBatch('movie', Array.from(movieIds));
      }
      if (showIds.size > 0) {
        await enqueueTmdbTitleWarmBatch('tv', Array.from(showIds));
      }

      return {
        warmedMovies: movieIds.size,
        warmedShows: showIds.size,
      };
    } finally {
      client.release();
    }
  }

  private async syncProviderInteractionsToLocal(params: {
    job: ProviderImportJobRecord;
    providerSession: ProviderSessionRecord;
    historyGeneration: number;
    importedAt: string;
    payload: ProviderReplaceImportPayload;
  }): Promise<LocalProviderImportSyncResult> {
    return this.runInTransaction(async (client) => {
      const [profileRow, appUser] = await Promise.all([
        this.getLocalProfile(params.job.profileId),
        this.userRepository.findById(client, params.job.requestedByUserId),
      ]);

      if (!profileRow || !appUser) {
        logger.warn({
          profileId: params.job.profileId,
          requestedByUserId: params.job.requestedByUserId,
        }, 'local provider import sync skipped: missing local profile or app user');
        return {
          historyInserted: 0,
          watchlistInserted: 0,
          ratingsInserted: 0,
          playbackInserted: 0,
          skipped: true,
          warnings: ['Local provider import sync skipped: missing local profile or app user'],
        };
      }

      const facts = this.buildProviderImportFacts(params.payload);

      return this.localProviderHistoryWriter.replaceImportedInteractions(client, {
        appUser,
        job: params.job,
        profile: profileRow,
        providerSession: params.providerSession,
        historyGeneration: params.historyGeneration,
        importedAt: params.importedAt,
        ...facts,
      });
    });
  }

  private async getLocalProfile(profileId: string): Promise<ProfileRecord | null> {
    try {
      const result = await db.query(
        `SELECT id, account_id AS profile_group_id, name, interface_language, region, avatar_url, is_kids, sort_order, created_by_account_id, created_at, updated_at
         FROM identity.profiles
         WHERE id = $1::uuid AND deleted_at IS NULL`,
        [profileId],
      );
      if (!result.rows[0]) return null;
      const r = result.rows[0];
      return {
        id: String(r.id),
        profileGroupId: String(r.profile_group_id),
        name: String(r.name),
        interfaceLanguage: typeof r.interface_language === 'string' ? r.interface_language : 'en',
        region: typeof r.region === 'string' ? r.region : null,
        avatarUrl: typeof r.avatar_url === 'string' ? r.avatar_url : null,
        isKids: Boolean(r.is_kids),
        sortOrder: Number(r.sort_order),
        createdByUserId: typeof r.created_by_account_id === 'string' ? r.created_by_account_id : null,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      } as ProfileRecord;
    } catch {
      return null;
    }
  }

  private buildProviderImportFacts(payload: ProviderReplaceImportPayload): ProviderImportFacts {
    const historyEntries = payload.importedHistoryEntries.map((entry) => ({
      mediaKey: entry.mediaKey,
      mediaType: entry.mediaType,
      watchedAt: entry.watchedAt,
      seasonNumber: entry.seasonNumber ?? null,
      episodeNumber: entry.episodeNumber ?? null,
    }));
    const watchlistItems: ImportedProviderListItem[] = [];
    const ratings: ImportedProviderRating[] = [];
    const playbackStates: ImportedProviderPlaybackState[] = [];

    for (const event of payload.importedEvents) {
      if (event.eventType === 'watchlist_put') {
        const titleIdentity = this.resolveProviderEventTitleIdentity(event);
        watchlistItems.push({
          mediaKey: canonicalTitleMediaKey(titleIdentity),
          mediaType: canonicalTitleMediaType(titleIdentity),
          addedAt: event.occurredAt,
        });
        continue;
      }

      if (event.eventType === 'rating_put' && typeof event.rating === 'number' && Number.isFinite(event.rating)) {
        const titleIdentity = this.resolveProviderEventTitleIdentity(event);
        ratings.push({
          mediaKey: canonicalTitleMediaKey(titleIdentity),
          mediaType: canonicalTitleMediaType(titleIdentity),
          rating: event.rating,
          ratedAt: event.occurredAt,
        });
        continue;
      }

      if (event.eventType === 'playback_progress_snapshot' || event.eventType === 'playback_completed') {
        const durationSeconds = positiveIntegerOrNull(event.durationSeconds);
        const positionSeconds = nonNegativeIntegerOrNull(event.positionSeconds);
        const progressBps = clampProgressBps(event.progressBps ?? progressBpsFromPosition(positionSeconds, durationSeconds));
        playbackStates.push({
          mediaKey: event.mediaKey,
          titleMediaKey: this.resolveProviderEventTitleMediaKey(event),
          mediaType: event.mediaType,
          positionSeconds: positionSeconds ?? 0,
          durationSeconds: durationSeconds ?? 0,
          progressBps,
          occurredAt: event.occurredAt,
          completed: event.eventType === 'playback_completed',
        });
      }
    }

    return { historyEntries, watchlistItems, ratings, playbackStates };
  }

  private resolveProviderEventTitleMediaKey(event: ImportedWatchEventDraft): string {
    return canonicalTitleMediaKey(this.resolveProviderEventTitleIdentity(event));
  }

  private resolveProviderEventTitleIdentity(event: ImportedWatchEventDraft): MediaIdentity {
    return inferMediaIdentity({
      mediaKey: event.mediaKey,
      mediaType: event.mediaType,
      seasonNumber: event.seasonNumber ?? null,
      episodeNumber: event.episodeNumber ?? null,
      absoluteEpisodeNumber: event.absoluteEpisodeNumber ?? null,
    });
  }
}

export function parseImportProvider(value: unknown): ProviderImportProvider {
  if (!isProviderImportProvider(value)) {
    throw new HttpError(400, 'Provider must be either trakt or simkl.');
  }
  return value;
}
