import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { ProviderTokenAccessService } from '../../modules/imports/provider-token-access.service.js';
import { isProviderImportProvider, type ProviderImportProvider } from '../../modules/imports/provider-import.types.js';
import { RecommendationDataService } from '../../modules/recommendations/recommendation-data.service.js';
import { RecommendationOutputService } from '../../modules/recommendations/recommendation-output.service.js';
import { ProfileSecretAccessService } from '../../modules/profiles/profile-secret-access.service.js';
import { AccountSettingsService } from '../../modules/users/account-settings.service.js';
import { AccountLookupService } from '../../modules/users/account-lookup.service.js';

export async function registerInternalAccountRoutes(app: FastifyInstance): Promise<void> {
  const accountLookupService = new AccountLookupService();
  const recommendationDataService = new RecommendationDataService();
  const recommendationOutputService = new RecommendationOutputService();
  const profileSecretAccessService = new ProfileSecretAccessService();
  const accountSettingsService = new AccountSettingsService();
  const providerTokenAccessService = new ProviderTokenAccessService();

  app.get('/internal/v1/accounts/by-email/:email', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profiles:read']);
    const params = request.params as { email: string };
    return {
      account: await accountLookupService.getByEmail(params.email),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profiles:read']);
    const params = request.params as { accountId: string };
    return {
      profiles: await recommendationDataService.listAccountProfilesForService(params.accountId),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/watch-history', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { accountId: string; profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationDataService.getWatchHistoryForAccountService(params.accountId, params.profileId, limit),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/continue-watching', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { accountId: string; profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 50, 1, 250);
    return {
      items: await recommendationDataService.getContinueWatchingForAccountService(params.accountId, params.profileId, limit),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/watchlist', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { accountId: string; profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationDataService.getWatchlistForAccountService(params.accountId, params.profileId, limit),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/ratings', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { accountId: string; profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 100, 1, 500);
    return {
      items: await recommendationDataService.getRatingsForAccountService(params.accountId, params.profileId, limit),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/tracked-series', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['watch:read']);
    const params = request.params as { accountId: string; profileId: string };
    const limit = clampLimit(parseOptionalNumber((request.query as Record<string, unknown>).limit) ?? 25, 1, 100);
    return {
      items: await recommendationDataService.getTrackedSeriesForAccountService(params.accountId, params.profileId, limit),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/taste-profile', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['taste-profile:read']);
    const params = request.params as { accountId: string; profileId: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    return {
      tasteProfile: await recommendationOutputService.getTasteProfileForAccountService(
        params.accountId,
        params.profileId,
        parseSourceKey(query.sourceKey),
      ),
    };
  });

  app.put('/internal/v1/accounts/:accountId/profiles/:profileId/taste-profile', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['taste-profile:write']);
    const params = request.params as { accountId: string; profileId: string };
    return {
      tasteProfile: await recommendationOutputService.upsertTasteProfileForAccountService(
        params.accountId,
        params.profileId,
        parseTasteProfileInput(request.body),
      ),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/recommendations', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['recommendations:read']);
    const params = request.params as { accountId: string; profileId: string };
    const query = (request.query ?? {}) as Record<string, unknown>;
    return {
      recommendations: await recommendationOutputService.getRecommendationsForAccountService(
        params.accountId,
        params.profileId,
        parseSourceKey(query.sourceKey),
        parseAlgorithmVersion(query.algorithmVersion),
      ),
    };
  });

  app.put('/internal/v1/accounts/:accountId/profiles/:profileId/recommendations', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['recommendations:write']);
    const params = request.params as { accountId: string; profileId: string };
    return {
      recommendations: await recommendationOutputService.upsertRecommendationsForAccountService(
        params.accountId,
        params.profileId,
        parseRecommendationSnapshotInput(request.body),
      ),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/secrets/openrouter-key', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profile-secrets:read']);
    const params = request.params as { accountId: string; profileId: string };
    return {
      secret: await profileSecretAccessService.getAiApiKeyForAccountProfile(params.accountId, params.profileId),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/secrets/ai-api-key', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profile-secrets:read']);
    const params = request.params as { accountId: string; profileId: string };
    return {
      secret: await profileSecretAccessService.getAiApiKeyForAccountProfile(params.accountId, params.profileId),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/secrets/omdb-api-key', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['profile-secrets:read']);
    const params = request.params as { accountId: string; profileId: string };
    return {
      secret: await accountSettingsService.getSecretForAccountProfile(params.accountId, params.profileId, 'metadata.omdb_api_key'),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/connection', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['provider-connections:read']);
    const params = parseProviderParams(request.params);
    return {
      connection: await providerTokenAccessService.getConnectionForAccountProfile(params.accountId, params.profileId, params.provider),
    };
  });

  app.get('/internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/token-status', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['provider-tokens:read']);
    const params = parseProviderParams(request.params);
    return {
      tokenStatus: await providerTokenAccessService.getTokenStatusForAccountProfile(params.accountId, params.profileId, params.provider),
    };
  });

  app.post('/internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/access-token', async (request) => {
    await app.requireServiceAuth(request);
    const params = parseProviderParams(request.params);
    const forceRefresh = parseForceRefresh(request.body);
    app.requireScopes(request, forceRefresh ? ['provider-tokens:read', 'provider-tokens:refresh'] : ['provider-tokens:read']);
    return {
      accessToken: await providerTokenAccessService.getAccessTokenForAccountProfile(
        params.accountId,
        params.profileId,
        params.provider,
        { forceRefresh },
      ),
    };
  });

  app.post('/internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/refresh', async (request) => {
    await app.requireServiceAuth(request);
    app.requireScopes(request, ['provider-tokens:refresh']);
    const params = parseProviderParams(request.params);
    return {
      accessToken: await providerTokenAccessService.getAccessTokenForAccountProfile(
        params.accountId,
        params.profileId,
        params.provider,
        { forceRefresh: true },
      ),
    };
  });
}

function parseProviderParams(value: unknown): { accountId: string; profileId: string; provider: ProviderImportProvider } {
  const params = asRecord(value);
  const accountId = readRequiredString(params.accountId, 'accountId');
  const profileId = readRequiredString(params.profileId, 'profileId');
  const provider = params.provider;
  if (!isProviderImportProvider(provider)) {
    throw new HttpError(400, 'Invalid provider.');
  }
  return { accountId, profileId, provider };
}

function parseTasteProfileInput(body: unknown) {
  const value = asRecord(body);
  return {
    sourceKey: parseSourceKey(value.sourceKey),
    genres: Array.isArray(value.genres) ? value.genres : [],
    preferredActors: Array.isArray(value.preferredActors) ? value.preferredActors : [],
    preferredDirectors: Array.isArray(value.preferredDirectors) ? value.preferredDirectors : [],
    contentTypePref: asRecord(value.contentTypePref),
    ratingTendency: asRecord(value.ratingTendency),
    decadePreferences: Array.isArray(value.decadePreferences) ? value.decadePreferences : [],
    watchingPace: typeof value.watchingPace === 'string' ? value.watchingPace : null,
    aiSummary: typeof value.aiSummary === 'string' ? value.aiSummary : null,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : 'manual',
    updatedById: typeof value.updatedById === 'string' ? value.updatedById : null,
  };
}

function parseRecommendationSnapshotInput(body: unknown) {
  const value = asRecord(body);
  const algorithmVersion = typeof value.algorithmVersion === 'string' && value.algorithmVersion.trim()
    ? value.algorithmVersion.trim()
    : null;
  if (!algorithmVersion) {
    throw new HttpError(400, 'algorithmVersion is required.');
  }

  const historyGeneration = Number(value.historyGeneration);
  if (!Number.isInteger(historyGeneration) || historyGeneration < 0) {
    throw new HttpError(400, 'historyGeneration must be a non-negative integer.');
  }

  const generatedAt = typeof value.generatedAt === 'string' && value.generatedAt.trim() ? value.generatedAt : null;
  if (!generatedAt) {
    throw new HttpError(400, 'generatedAt is required.');
  }

  return {
    sourceKey: parseSourceKey(value.sourceKey),
    historyGeneration,
    algorithmVersion,
    sourceCursor: typeof value.sourceCursor === 'string' ? value.sourceCursor : null,
    generatedAt,
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : 'manual',
    updatedById: typeof value.updatedById === 'string' ? value.updatedById : null,
    sections: Array.isArray(value.sections) ? value.sections : [],
  };
}

function parseSourceKey(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new HttpError(400, 'sourceKey is required.');
}

function parseAlgorithmVersion(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return 'default';
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseForceRefresh(value: unknown): boolean {
  const body = asRecord(value);
  return body.forceRefresh === true || body.forceRefresh === 'true';
}

function readRequiredString(value: unknown, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
