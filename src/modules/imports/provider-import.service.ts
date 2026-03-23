import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db, withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { enqueueProviderImport } from '../../lib/queue.js';
import { logger } from '../../config/logger.js';
import { redis } from '../../lib/redis.js';
import { TmdbExternalIdResolverService } from '../metadata/tmdb-external-id-resolver.service.js';
import { TmdbRefreshService } from '../metadata/tmdb-refresh.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import {
  ProviderImportConnectionsRepository,
  type ProviderImportConnectionRecord,
} from './provider-import-connections.repo.js';
import { ProviderImportJobsRepository, type ProviderImportJobRecord } from './provider-import-jobs.repo.js';
import { ProfileWatchDataStateRepository, type ProfileWatchDataStateRecord } from './profile-watch-data-state.repo.js';
import { isProviderImportProvider, type ProviderImportProvider } from './provider-import.types.js';
import {
  ProviderDestructiveImportService,
  type ImportedHistoryEntryDraft,
  type ImportedWatchEventDraft,
  type ProviderReplaceImportPayload,
} from './provider-destructive-import.service.js';
import { mapConnectionView, type ProviderImportConnectionView } from './provider-import.views.js';

export type StartedProviderImport = {
  job: ProviderImportJobRecord;
  connection: ProviderImportConnectionRecord | null;
  watchDataState: ProfileWatchDataStateRecord;
  authUrl: string | null;
  nextAction: 'authorize_provider' | 'queued';
};

export type CompletedProviderImportCallback = {
  job: ProviderImportJobRecord;
  connection: ProviderImportConnectionRecord;
  nextAction: 'queued';
};

type ProviderTokenExchangeResult = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  raw: Record<string, unknown>;
};

type ProviderProfileResult = {
  providerUserId: string | null;
  externalUsername: string | null;
};

type ProviderCallbackParams = {
  state: string;
  code?: string;
  error?: string;
  errorDescription?: string;
};

export class ProviderImportService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly connectionsRepository = new ProviderImportConnectionsRepository(),
    private readonly jobsRepository = new ProviderImportJobsRepository(),
    private readonly watchDataStateRepository = new ProfileWatchDataStateRepository(),
    private readonly destructiveImportService = new ProviderDestructiveImportService(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
    private readonly tmdbRefreshService = new TmdbRefreshService(),
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

      const stateToken = randomUUID();
      const pkce = generatePkcePair();
      const authUrl = this.buildAuthUrl(provider, stateToken, pkce.codeChallenge);
      if (!authUrl) {
        throw new HttpError(503, `Provider import is not configured for ${provider}.`);
      }

      const connection = await this.connectionsRepository.createPending(client, {
        profileId,
        provider,
        createdByUserId: userId,
        stateToken,
        credentialsJson: {
          pkceCodeVerifier: pkce.codeVerifier,
          pkceCodeChallenge: pkce.codeChallenge,
        },
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
        authUrl,
        nextAction: 'authorize_provider' as const,
      };
    });

    if (started.nextAction === 'queued') {
      await enqueueProviderImport(profileId, started.job.id);
    }

    return started;
  }

  async completeOAuthCallback(
    provider: ProviderImportProvider,
    params: ProviderCallbackParams,
  ): Promise<CompletedProviderImportCallback> {
    const completed = await withTransaction(async (client) => {
      const connection = await this.connectionsRepository.findPendingByStateToken(client, provider, params.state);
      if (!connection) {
        throw new HttpError(404, 'Provider import connection not found for callback state.');
      }

      const pendingJob = await this.jobsRepository.findLatestOauthPendingForConnection(client, connection.id);
      if (!pendingJob) {
        throw new HttpError(404, 'Provider import job not found for callback state.');
      }

      const now = Date.now();
      if (connection.expiresAt && Date.parse(connection.expiresAt) < now) {
        await this.connectionsRepository.markExpired(client, connection.id);
        await this.jobsRepository.markFailed(client, pendingJob.id, {
          code: 'provider_oauth_expired',
          message: 'Provider authorization expired before callback completion.',
          retryable: true,
        });
        throw new HttpError(410, 'Provider authorization has expired. Start the import again.');
      }

      if (params.error) {
        await this.connectionsRepository.markExpired(client, connection.id);
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

      const codeVerifier = typeof connection.credentialsJson.pkceCodeVerifier === 'string'
        ? connection.credentialsJson.pkceCodeVerifier
        : '';
      if (!codeVerifier) {
        throw new HttpError(400, 'Missing stored PKCE verifier for provider callback.');
      }

      const exchanged = provider === 'trakt'
        ? await this.exchangeTraktAuthorizationCode(code, codeVerifier)
        : await this.exchangeSimklAuthorizationCode(code, codeVerifier);
      const profile = provider === 'trakt'
        ? await this.fetchTraktProfile(exchanged.accessToken)
        : await this.fetchSimklProfile(exchanged.accessToken);
      const connectedAt = new Date().toISOString();

      await this.connectionsRepository.revokeOtherConnectedForProfile(client, connection.profileId, provider, connection.id);
      const updatedConnection = await this.connectionsRepository.markConnected(client, {
        connectionId: connection.id,
        providerUserId: profile.providerUserId,
        externalUsername: profile.externalUsername,
        connectedAt,
        credentialsJson: {
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken,
          accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
          providerUserId: profile.providerUserId,
          externalUsername: profile.externalUsername,
          connectedAt,
          lastRefreshAt: connectedAt,
          lastRefreshError: null,
          tokenPayload: exchanged.raw,
        },
      });

      await this.jobsRepository.markQueued(client, pendingJob.id, {
        connectionId: updatedConnection.id,
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
        connection: updatedConnection,
        nextAction: 'queued' as const,
      };
    });

    await enqueueProviderImport(completed.connection.profileId, completed.job.id);
    return completed;
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

  async listConnections(
    userId: string,
    profileId: string,
  ): Promise<{ connections: ProviderImportConnectionView[]; watchDataState: ProfileWatchDataStateRecord | null }> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const [connections, watchDataState] = await Promise.all([
        this.connectionsRepository.listForProfile(client, profileId),
        this.watchDataStateRepository.getForProfile(client, profileId),
      ]);

      return {
        connections: connections.map((connection) => mapConnectionView(connection)),
        watchDataState,
      };
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
    const requestId = randomUUID();

    const runningJob = await withTransaction(async (client) => {
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
      const connection = await withTransaction(async (client) => {
        if (!runningJob.connectionId) {
          throw new HttpError(400, 'Queued provider import is missing a provider connection.');
        }

        const found = await this.connectionsRepository.findById(client, runningJob.connectionId);
        if (!found || found.status !== 'connected') {
          throw new HttpError(400, 'Queued provider import does not have a connected provider account.');
        }

        return found;
      });

      const importedPayload = runningJob.provider === 'trakt'
        ? await this.fetchAndNormalizeTraktImport(runningJob, connection)
        : await this.fetchAndNormalizeSimklImport(runningJob, connection);

      const replaceResult = await withTransaction(async (client) => {
        return this.destructiveImportService.replaceProfileWatchData(client, {
          job: runningJob,
          provider: runningJob.provider,
          payload: importedPayload,
        });
      });

      const warnings: string[] = [];
      let metadataSummary: Record<string, unknown> = {
        refreshedTitles: 0,
        refreshedSeasons: 0,
        refreshedTrackedShows: 0,
        skipped: 0,
        failures: 0,
      };

      try {
        await this.destructiveImportService.clearBufferedPlayback(runningJob.profileId);
      } catch (error) {
        warnings.push(`failed to clear buffered playback: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      try {
        metadataSummary = await this.refreshImportedMetadata(runningJob.profileId, replaceResult.mediaKeysToRefresh);
        if (Number(metadataSummary.failures ?? 0) > 0) {
          warnings.push(`metadata refresh failures: ${String(metadataSummary.failures)}`);
        }
      } catch (error) {
        warnings.push(`failed to refresh metadata: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      try {
        await this.markConnectionImportComplete(connection, runningJob.id, importedPayload.importedAt);
      } catch (error) {
        warnings.push(`failed to update provider connection usage: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      try {
        await redis.del(`home:${runningJob.profileId}`, `calendar:${runningJob.profileId}`);
      } catch (error) {
        warnings.push(`failed to invalidate caches: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      await withTransaction(async (client) => {
        const payload = {
          checkpointJson: {
            phase: 'completed',
            requestId,
            warnings,
          },
          summaryJson: {
            ...importedPayload.importSummary,
            insertedEvents: replaceResult.insertedEvents,
            insertedHistoryEntries: replaceResult.insertedHistoryEntries,
            projectionSummary: replaceResult.projectionSummary,
            metadataSummary,
            historyGeneration: replaceResult.watchDataState.historyGeneration,
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
        insertedEvents: replaceResult.insertedEvents,
        insertedHistoryEntries: replaceResult.insertedHistoryEntries,
        warnings,
      }, 'provider replace import completed');
    } catch (error) {
      await withTransaction(async (client) => {
        await this.jobsRepository.markFailed(client, runningJob.id, {
          code: error instanceof HttpError && error.statusCode === 503
            ? 'provider_import_not_implemented'
            : 'provider_import_failed',
          message: error instanceof Error ? error.message : 'Provider import failed.',
          retryable: false,
          requestId,
        });
      });

      if (runningJob.provider === 'simkl') {
        logger.warn({ importJobId: runningJob.id, err: error }, 'simkl import remains unimplemented');
        return;
      }

      throw error;
    }
  }

  private buildAuthUrl(
    provider: ProviderImportProvider,
    stateToken: string | null,
    codeChallenge: string,
  ): string | null {
    if (!stateToken) {
      return null;
    }

    if (provider === 'trakt' && env.traktImportClientId && env.traktImportRedirectUri) {
      const url = new URL('https://trakt.tv/oauth/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', env.traktImportClientId);
      url.searchParams.set('redirect_uri', env.traktImportRedirectUri);
      url.searchParams.set('state', stateToken);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url.toString();
    }

    if (provider === 'simkl' && env.simklImportClientId && env.simklImportRedirectUri) {
      const url = new URL('https://simkl.com/oauth/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', env.simklImportClientId);
      url.searchParams.set('redirect_uri', env.simklImportRedirectUri);
      url.searchParams.set('state', stateToken);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url.toString();
    }

    return null;
  }

  private async exchangeTraktAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<ProviderTokenExchangeResult> {
    if (!env.traktImportClientId || !env.traktImportClientSecret || !env.traktImportRedirectUri) {
      throw new HttpError(503, 'Trakt import is not configured.');
    }

    const response = await fetch('https://api.trakt.tv/oauth/token', {
      method: 'POST',
      headers: buildTraktHeaders({ includeAuthorization: false }),
      body: JSON.stringify({
        code,
        client_id: env.traktImportClientId,
        client_secret: env.traktImportClientSecret,
        code_verifier: codeVerifier,
        redirect_uri: env.traktImportRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const rawBody = await response.text();
    const payload = parseProviderJson(rawBody);
    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      throw new HttpError(
        response.status || 502,
        resolveProviderError(payload, 'Unable to exchange the Trakt authorization code.'),
        rawBody.trim()
          ? {
              provider: 'trakt',
              providerStatus: response.status,
              responseBody: rawBody.slice(0, 500),
            }
          : {
              provider: 'trakt',
              providerStatus: response.status,
            },
      );
    }

    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      accessTokenExpiresAt: expiresAtIsoFromNow(payload.expires_in),
      raw: payload,
    };
  }

  private async exchangeSimklAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<ProviderTokenExchangeResult> {
    if (!env.simklImportClientId || !env.simklImportClientSecret || !env.simklImportRedirectUri) {
      throw new HttpError(503, 'Simkl import is not configured.');
    }

    const response = await fetch('https://api.simkl.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        client_id: env.simklImportClientId,
        client_secret: env.simklImportClientSecret,
        code_verifier: codeVerifier,
        redirect_uri: env.simklImportRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      throw new HttpError(response.status || 502, resolveProviderError(payload, 'Unable to exchange the Simkl authorization code.'));
    }

    return {
      accessToken: payload.access_token,
      refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
      accessTokenExpiresAt: expiresAtIsoFromNow(payload.expires_in),
      raw: payload,
    };
  }

  private async fetchTraktProfile(accessToken: string): Promise<ProviderProfileResult> {
    const response = await fetch('https://api.trakt.tv/users/settings', {
      method: 'GET',
      headers: buildTraktHeaders({ accessToken }),
    });

    if (!response.ok) {
      return {
        providerUserId: null,
        externalUsername: null,
      };
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const user = isRecord(payload?.user) ? payload.user : null;
    const ids = isRecord(user?.ids) ? user.ids : null;

    return {
      providerUserId: typeof ids?.slug === 'string' ? ids.slug : null,
      externalUsername: typeof user?.username === 'string' ? user.username : null,
    };
  }

  private async fetchSimklProfile(accessToken: string): Promise<ProviderProfileResult> {
    const response = await fetch('https://api.simkl.com/users/settings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'simkl-api-key': env.simklImportClientId,
      },
    });

    if (!response.ok) {
      return {
        providerUserId: null,
        externalUsername: null,
      };
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const account = isRecord(payload?.account) ? payload.account : null;
    const user = isRecord(payload?.user) ? payload.user : null;

    return {
      providerUserId:
        typeof account?.id === 'number' || typeof account?.id === 'string' ? String(account.id) : null,
      externalUsername: typeof user?.name === 'string' ? user.name : null,
    };
  }

  private async fetchAndNormalizeTraktImport(
    job: ProviderImportJobRecord,
    connection: ProviderImportConnectionRecord,
  ): Promise<ProviderReplaceImportPayload> {
    const accessToken = requireConnectedAccessToken(connection);

    const [watchedMovies, watchedShows, watchlistMovies, watchlistShows, ratingMovies, ratingShows, playback] = await Promise.all([
      this.traktGetArray('/sync/watched/movies', accessToken),
      this.traktGetArray('/sync/watched/shows', accessToken),
      this.traktGetArray('/sync/watchlist/movies', accessToken),
      this.traktGetArray('/sync/watchlist/shows', accessToken),
      this.traktGetArray('/sync/ratings/movies', accessToken),
      this.traktGetArray('/sync/ratings/shows', accessToken),
      this.traktGetArray('/sync/playback', accessToken),
    ]);

    const resolvedCache = new Map<string, number | null>();
    const importedEvents: ImportedWatchEventDraft[] = [];
    const importedHistoryEntries: ImportedHistoryEntryDraft[] = [];
    const mediaKeysToRefresh = new Set<string>();

    for (const item of watchedMovies) {
      const movie = getRecord(item.movie);
      const ids = getRecord(movie?.ids);
      const tmdbId = await this.resolveTmdbIdForImport(resolvedCache, {
        mediaType: 'movie',
        tmdbId: asPositiveInt(ids?.tmdb),
        imdbId: asString(ids?.imdb),
      });
      if (!tmdbId) {
        continue;
      }

      const occurredAt = asIsoString(item.last_watched_at) ?? new Date().toISOString();
      const mediaKey = `movie:tmdb:${tmdbId}`;
      importedEvents.push({
        eventType: 'mark_watched',
        mediaKey,
        mediaType: 'movie',
        tmdbId,
        occurredAt,
        payload: {
          provider: 'trakt',
          source: 'watched_movies',
        },
      });
      importedHistoryEntries.push({
        mediaKey,
        mediaType: 'movie',
        tmdbId,
        watchedAt: occurredAt,
        sourceKind: 'provider_import',
        payload: {
          provider: 'trakt',
          source: 'watched_movies',
        },
      });
      mediaKeysToRefresh.add(mediaKey);
    }

    for (const item of watchedShows) {
      const show = getRecord(item.show);
      const ids = getRecord(show?.ids);
      const showTmdbId = await this.resolveTmdbIdForImport(resolvedCache, {
        mediaType: 'show',
        tmdbId: asPositiveInt(ids?.tmdb),
        imdbId: asString(ids?.imdb),
        tvdbId: asString(ids?.tvdb),
      });
      if (!showTmdbId) {
        continue;
      }

      const seasons = asArray(item.seasons);
      for (const seasonValue of seasons) {
        const season = getRecord(seasonValue);
        const seasonNumber = asPositiveInt(season?.number);
        if (!seasonNumber) {
          continue;
        }

        const episodes = asArray(season?.episodes);
        for (const episodeValue of episodes) {
          const episode = getRecord(episodeValue);
          const episodeNumber = asPositiveInt(episode?.number);
          if (!episodeNumber) {
            continue;
          }

          const occurredAt = asIsoString(episode?.last_watched_at)
            ?? asIsoString(item.last_watched_at)
            ?? new Date().toISOString();
          const mediaKey = `episode:tmdb:${showTmdbId}:${seasonNumber}:${episodeNumber}`;
          importedEvents.push({
            eventType: 'mark_watched',
            mediaKey,
            mediaType: 'episode',
            showTmdbId,
            seasonNumber,
            episodeNumber,
            occurredAt,
            payload: {
              provider: 'trakt',
              source: 'watched_shows',
            },
          });
          importedHistoryEntries.push({
            mediaKey,
            mediaType: 'episode',
            showTmdbId,
            seasonNumber,
            episodeNumber,
            watchedAt: occurredAt,
            sourceKind: 'provider_import',
            payload: {
              provider: 'trakt',
              source: 'watched_shows',
            },
          });
          mediaKeysToRefresh.add(mediaKey);
        }
      }
    }

    for (const item of [...watchlistMovies, ...watchlistShows]) {
      const movie = getRecord(item.movie);
      const show = getRecord(item.show);
      const node = movie ?? show;
      const mediaType = movie ? 'movie' : 'show';
      const ids = getRecord(node?.ids);
      const tmdbId = await this.resolveTmdbIdForImport(resolvedCache, {
        mediaType,
        tmdbId: asPositiveInt(ids?.tmdb),
        imdbId: asString(ids?.imdb),
        tvdbId: mediaType === 'show' ? asString(ids?.tvdb) : null,
      });
      if (!tmdbId) {
        continue;
      }

      const occurredAt = asIsoString(item.listed_at) ?? new Date().toISOString();
      const mediaKey = `${mediaType}:tmdb:${tmdbId}`;
      importedEvents.push({
        eventType: 'watchlist_put',
        mediaKey,
        mediaType,
        tmdbId,
        showTmdbId: mediaType === 'show' ? tmdbId : null,
        occurredAt,
        payload: {
          provider: 'trakt',
          source: 'watchlist',
        },
      });
      mediaKeysToRefresh.add(mediaKey);
    }

    for (const item of [...ratingMovies, ...ratingShows]) {
      const movie = getRecord(item.movie);
      const show = getRecord(item.show);
      const node = movie ?? show;
      const mediaType = movie ? 'movie' : 'show';
      const ids = getRecord(node?.ids);
      const tmdbId = await this.resolveTmdbIdForImport(resolvedCache, {
        mediaType,
        tmdbId: asPositiveInt(ids?.tmdb),
        imdbId: asString(ids?.imdb),
        tvdbId: mediaType === 'show' ? asString(ids?.tvdb) : null,
      });
      const rating = asPositiveInt(item.rating);
      if (!tmdbId || !rating) {
        continue;
      }

      const occurredAt = asIsoString(item.rated_at) ?? new Date().toISOString();
      const mediaKey = `${mediaType}:tmdb:${tmdbId}`;
      importedEvents.push({
        eventType: 'rating_put',
        mediaKey,
        mediaType,
        tmdbId,
        showTmdbId: mediaType === 'show' ? tmdbId : null,
        rating,
        occurredAt,
        payload: {
          provider: 'trakt',
          source: 'ratings',
        },
      });
      mediaKeysToRefresh.add(mediaKey);
    }

    for (const item of playback) {
      const type = asString(item.type)?.toLowerCase();
      if (type === 'movie') {
        const movie = getRecord(item.movie);
        const ids = getRecord(movie?.ids);
        const tmdbId = await this.resolveTmdbIdForImport(resolvedCache, {
          mediaType: 'movie',
          tmdbId: asPositiveInt(ids?.tmdb),
          imdbId: asString(ids?.imdb),
        });
        if (!tmdbId) {
          continue;
        }

        const progress = asFiniteNumber(item.progress);
        const durationSeconds = durationSecondsFromRuntime(movie?.runtime);
        const positionSeconds = progress !== null && durationSeconds !== null
          ? Math.max(1, Math.round((durationSeconds * progress) / 100))
          : null;
        const occurredAt = asIsoString(item.paused_at) ?? new Date().toISOString();
        const mediaKey = `movie:tmdb:${tmdbId}`;
        importedEvents.push({
          eventType: progress !== null && progress >= 90 ? 'playback_completed' : 'playback_progress_snapshot',
          mediaKey,
          mediaType: 'movie',
          tmdbId,
          positionSeconds,
          durationSeconds,
          occurredAt,
          payload: {
            provider: 'trakt',
            source: 'playback',
            playbackId: asString(item.id),
            progressPercent: progress,
          },
        });
        mediaKeysToRefresh.add(mediaKey);
        continue;
      }

      if (type === 'episode') {
        const show = getRecord(item.show);
        const episode = getRecord(item.episode);
        const ids = getRecord(show?.ids);
        const showTmdbId = await this.resolveTmdbIdForImport(resolvedCache, {
          mediaType: 'show',
          tmdbId: asPositiveInt(ids?.tmdb),
          imdbId: asString(ids?.imdb),
          tvdbId: asString(ids?.tvdb),
        });
        const seasonNumber = asPositiveInt(episode?.season);
        const episodeNumber = asPositiveInt(episode?.number);
        if (!showTmdbId || !seasonNumber || !episodeNumber) {
          continue;
        }

        const progress = asFiniteNumber(item.progress);
        const durationSeconds = durationSecondsFromRuntime(episode?.runtime);
        const positionSeconds = progress !== null && durationSeconds !== null
          ? Math.max(1, Math.round((durationSeconds * progress) / 100))
          : null;
        const occurredAt = asIsoString(item.paused_at) ?? new Date().toISOString();
        const mediaKey = `episode:tmdb:${showTmdbId}:${seasonNumber}:${episodeNumber}`;
        importedEvents.push({
          eventType: progress !== null && progress >= 90 ? 'playback_completed' : 'playback_progress_snapshot',
          mediaKey,
          mediaType: 'episode',
          showTmdbId,
          seasonNumber,
          episodeNumber,
          positionSeconds,
          durationSeconds,
          occurredAt,
          payload: {
            provider: 'trakt',
            source: 'playback',
            playbackId: asString(item.id),
            progressPercent: progress,
          },
        });
        mediaKeysToRefresh.add(mediaKey);
      }
    }

    const importedAt = new Date().toISOString();
    return {
      importedEvents,
      importedHistoryEntries,
      importedAt,
      mediaKeysToRefresh: Array.from(mediaKeysToRefresh),
      importSummary: {
        provider: 'trakt',
        watchedMovieCount: watchedMovies.length,
        watchedShowCount: watchedShows.length,
        watchlistCount: watchlistMovies.length + watchlistShows.length,
        ratingCount: ratingMovies.length + ratingShows.length,
        playbackCount: playback.length,
      },
    };
  }

  private async fetchAndNormalizeSimklImport(
    _job: ProviderImportJobRecord,
    _connection: ProviderImportConnectionRecord,
  ): Promise<ProviderReplaceImportPayload> {
    throw new HttpError(503, 'Simkl replace import is not implemented yet.');
  }

  private async markConnectionImportComplete(
    connection: ProviderImportConnectionRecord,
    importJobId: string,
    importedAt: string,
  ): Promise<void> {
    const client = await db.connect();
    try {
      await this.connectionsRepository.updateConnectedCredentials(client, {
        connectionId: connection.id,
        credentialsJson: {
          ...connection.credentialsJson,
          lastImportJobId: importJobId,
          lastImportCompletedAt: importedAt,
        },
        providerUserId: connection.providerUserId,
        externalUsername: connection.externalUsername,
        lastUsedAt: importedAt,
      });
    } finally {
      client.release();
    }
  }

  private async refreshImportedMetadata(profileId: string, mediaKeys: string[]): Promise<Record<string, unknown>> {
    const client = await db.connect();
    try {
      const seen = new Set<string>();
      const summary = {
        refreshedTitles: 0,
        refreshedSeasons: 0,
        refreshedTrackedShows: 0,
        skipped: 0,
        failures: 0,
      };

      for (const mediaKey of mediaKeys) {
        const normalized = mediaKey.trim();
        if (!normalized || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        try {
          const result = await this.tmdbRefreshService.refreshMediaKey(client, profileId, normalized);
          summary.refreshedTitles += result.refreshedTitles;
          summary.refreshedSeasons += result.refreshedSeasons;
          summary.refreshedTrackedShows += result.refreshedTrackedShows;
          summary.skipped += result.skipped;
          summary.failures += result.failures;
        } catch {
          summary.failures += 1;
        }
      }

      return summary;
    } finally {
      client.release();
    }
  }

  private async traktGetArray(path: string, accessToken: string): Promise<Array<Record<string, unknown>>> {
    const response = await fetch(`https://api.trakt.tv${path}`, {
      method: 'GET',
      headers: buildTraktHeaders({ accessToken }),
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || !Array.isArray(payload)) {
      throw new HttpError(response.status || 502, `Trakt import request failed for ${path}.`);
    }

    return payload.filter(isRecord);
  }

  private async resolveTmdbIdForImport(
    cache: Map<string, number | null>,
    params: {
      mediaType: 'movie' | 'show';
      tmdbId?: number | null;
      imdbId?: string | null;
      tvdbId?: string | null;
    },
  ): Promise<number | null> {
    if (params.tmdbId && params.tmdbId > 0) {
      return params.tmdbId;
    }

    const client = await db.connect();
    try {
      const imdbId = params.imdbId?.trim();
      if (imdbId) {
        const cacheKey = `${params.mediaType}:imdb:${imdbId}`;
        if (cache.has(cacheKey)) {
          return cache.get(cacheKey) ?? null;
        }
        const resolved = await this.externalIdResolver.resolve(client, {
          source: 'imdb_id',
          externalId: imdbId,
          mediaType: params.mediaType,
        });
        cache.set(cacheKey, resolved);
        return resolved;
      }

      const tvdbId = params.tvdbId?.trim();
      if (tvdbId && params.mediaType === 'show') {
        const cacheKey = `${params.mediaType}:tvdb:${tvdbId}`;
        if (cache.has(cacheKey)) {
          return cache.get(cacheKey) ?? null;
        }
        const resolved = await this.externalIdResolver.resolve(client, {
          source: 'tvdb_id',
          externalId: tvdbId,
          mediaType: 'show',
        });
        cache.set(cacheKey, resolved);
        return resolved;
      }

      return null;
    } finally {
      client.release();
    }
  }
}

export function parseImportProvider(value: unknown): ProviderImportProvider {
  if (!isProviderImportProvider(value)) {
    throw new HttpError(400, 'Provider must be either trakt or simkl.');
  }
  return value;
}

function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function resolveProviderError(payload: Record<string, unknown> | null, fallback: string): string {
  if (typeof payload?.error_description === 'string' && payload.error_description.trim()) {
    return payload.error_description;
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

function expiresAtIsoFromNow(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(Date.now() + value * 1000).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asIsoString(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  return Number.isNaN(Date.parse(text)) ? null : text;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseProviderJson(rawBody: string): Record<string, unknown> | null {
  if (!rawBody.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildTraktHeaders(params: {
  accessToken?: string;
  includeAuthorization?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'trakt-api-key': env.traktImportClientId,
    'trakt-api-version': '2',
    'User-Agent': 'CrispyServer/1.0',
  };

  if (params.includeAuthorization !== false && params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }

  return headers;
}

function durationSecondsFromRuntime(value: unknown): number | null {
  const runtimeMinutes = asFiniteNumber(value);
  if (runtimeMinutes === null || runtimeMinutes <= 0) {
    return null;
  }
  return Math.round(runtimeMinutes * 60);
}

function requireConnectedAccessToken(connection: ProviderImportConnectionRecord): string {
  const accessToken = asString(connection.credentialsJson.accessToken);
  if (!accessToken) {
    throw new HttpError(400, 'Provider connection is missing an access token.');
  }
  return accessToken;
}
