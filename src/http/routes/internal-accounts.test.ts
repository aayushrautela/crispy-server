import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read","watch:read","taste-profile:read","taste-profile:write","recommendations:read","recommendations:write","profile-secrets:read","provider-connections:read","provider-tokens:read","provider-tokens:refresh"]}]';
}

seedTestEnv();

test('internal account routes resolve account by email and profile-scoped data under account path', async (t) => {
  const { AccountLookupService } = await import('../../modules/users/account-lookup.service.js');
  const { RecommendationDataService } = await import('../../modules/recommendations/recommendation-data.service.js');
  const { RecommendationOutputService } = await import('../../modules/recommendations/recommendation-output.service.js');
  const { ProfileSecretAccessService } = await import('../../modules/profiles/profile-secret-access.service.js');
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const { ProviderTokenAccessService } = await import('../../modules/imports/provider-token-access.service.js');
  const { registerInternalAccountRoutes } = await import('./internal-accounts.js');
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');

  const originalGetByEmail = AccountLookupService.prototype.getByEmail;
  const originalListAccountProfilesForService = RecommendationDataService.prototype.listAccountProfilesForService;
  const originalGetWatchHistoryForAccountService = RecommendationDataService.prototype.getWatchHistoryForAccountService;
  const originalGetContinueWatchingForAccountService = RecommendationDataService.prototype.getContinueWatchingForAccountService;
  const originalGetTasteProfileForAccountService = RecommendationOutputService.prototype.getTasteProfileForAccountService;
  const originalUpsertRecommendationsForAccountService = RecommendationOutputService.prototype.upsertRecommendationsForAccountService;
  const originalGetAiApiKeyForAccountProfile = ProfileSecretAccessService.prototype.getAiApiKeyForAccountProfile;
  const originalGetSecretForAccountProfile = AccountSettingsService.prototype.getSecretForAccountProfile;
  const originalGetConnectionForAccountProfile = ProviderTokenAccessService.prototype.getConnectionForAccountProfile;
  const originalGetAccessTokenForAccountProfile = ProviderTokenAccessService.prototype.getAccessTokenForAccountProfile;

  t.after(() => {
    AccountLookupService.prototype.getByEmail = originalGetByEmail;
    RecommendationDataService.prototype.listAccountProfilesForService = originalListAccountProfilesForService;
    RecommendationDataService.prototype.getWatchHistoryForAccountService = originalGetWatchHistoryForAccountService;
    RecommendationDataService.prototype.getContinueWatchingForAccountService = originalGetContinueWatchingForAccountService;
    RecommendationOutputService.prototype.getTasteProfileForAccountService = originalGetTasteProfileForAccountService;
    RecommendationOutputService.prototype.upsertRecommendationsForAccountService = originalUpsertRecommendationsForAccountService;
    ProfileSecretAccessService.prototype.getAiApiKeyForAccountProfile = originalGetAiApiKeyForAccountProfile;
    AccountSettingsService.prototype.getSecretForAccountProfile = originalGetSecretForAccountProfile;
    ProviderTokenAccessService.prototype.getConnectionForAccountProfile = originalGetConnectionForAccountProfile;
    ProviderTokenAccessService.prototype.getAccessTokenForAccountProfile = originalGetAccessTokenForAccountProfile;
  });

  AccountLookupService.prototype.getByEmail = async function (email) {
    return { accountId: `acct:${email}`, email } as never;
  };
  RecommendationDataService.prototype.listAccountProfilesForService = async function (accountId) {
    return [{ id: 'profile-1', accountId, name: 'Me', isKids: false, updatedAt: '2026-03-25T00:00:00.000Z' }] as never;
  };
  RecommendationDataService.prototype.getWatchHistoryForAccountService = async function (accountId, profileId, limit) {
    return [{ accountId, profileId, limit }] as never;
  };
  RecommendationDataService.prototype.getContinueWatchingForAccountService = async function (accountId, profileId, limit) {
    return [{ id: 'cw-1', accountId, profileId, limit, lastActivityAt: '2026-03-25T00:00:00.000Z' }] as never;
  };
  RecommendationOutputService.prototype.getTasteProfileForAccountService = async function (accountId, profileId, sourceKey) {
    return { accountId, profileId, sourceKey } as never;
  };
  RecommendationOutputService.prototype.upsertRecommendationsForAccountService = async function (accountId, profileId, input) {
    return { accountId, profileId, sourceKey: input.sourceKey, algorithmVersion: input.algorithmVersion } as never;
  };
  ProfileSecretAccessService.prototype.getAiApiKeyForAccountProfile = async function (accountId, profileId) {
    return { appUserId: accountId, key: 'ai.openrouter_key', value: `or:${profileId}` } as never;
  };
  AccountSettingsService.prototype.getSecretForAccountProfile = async function (accountId, profileId, field) {
    return { appUserId: accountId, key: field, value: `secret:${profileId}` } as never;
  };
  ProviderTokenAccessService.prototype.getConnectionForAccountProfile = async function (accountId, profileId, provider) {
    return { connectionId: 'conn-1', profileId, provider, status: 'connected', accountId } as never;
  };
  ProviderTokenAccessService.prototype.getAccessTokenForAccountProfile = async function (accountId, profileId, provider, options) {
    return { connectionId: 'conn-1', profileId, provider, accessToken: `${accountId}:${profileId}`, refreshed: options?.forceRefresh === true } as never;
  };

  const app = Fastify();
  app.decorateRequest('auth');
  app.decorate('requireServiceAuth', async () => {});
  app.decorate('requireScopes', () => {});
  app.decorate('requireAuth', async () => {});
  app.decorate('requireUserActor', () => ({
    type: 'user',
    appUserId: 'user-1',
    serviceId: null,
    scopes: [],
    authSubject: 'auth-subject',
    email: 'test@example.com',
    tokenId: null,
    consumerId: null,
  }));
  await app.register(errorHandlerPlugin);
  await registerInternalAccountRoutes(app);
  t.after(async () => {
    await app.close();
  });

  const lookup = await app.inject({ method: 'GET', url: '/internal/v1/accounts/by-email/test@example.com' });
  assert.equal(lookup.statusCode, 200);
  assert.equal(lookup.json().account.accountId, 'acct:test@example.com');

  const profiles = await app.inject({ method: 'GET', url: '/internal/v1/accounts/account-1/profiles' });
  assert.equal(profiles.statusCode, 200);
  assert.equal(profiles.json().profiles[0].accountId, 'account-1');

  const history = await app.inject({ method: 'GET', url: '/internal/v1/accounts/account-1/profiles/profile-1/watch-history?limit=22' });
  assert.equal(history.statusCode, 200);
  assert.deepEqual(history.json().items[0], { accountId: 'account-1', profileId: 'profile-1', limit: 22 });

  const continueWatching = await app.inject({ method: 'GET', url: '/internal/v1/accounts/account-1/profiles/profile-1/continue-watching?limit=9' });
  assert.equal(continueWatching.statusCode, 200);
  assert.equal(continueWatching.json().items[0].id, 'cw-1');
  assert.equal(continueWatching.json().items[0].limit, 9);

  const taste = await app.inject({ method: 'GET', url: '/internal/v1/accounts/account-1/profiles/profile-1/taste-profile?sourceKey=engine-x' });
  assert.equal(taste.statusCode, 200);
  assert.equal(taste.json().tasteProfile.sourceKey, 'engine-x');

  const recommendations = await app.inject({
    method: 'PUT',
    url: '/internal/v1/accounts/account-1/profiles/profile-1/recommendations',
    payload: {
      sourceKey: 'engine-x',
      historyGeneration: 3,
      algorithmVersion: 'v2',
      generatedAt: '2026-03-25T00:00:00.000Z',
      sections: [],
      source: 'manual',
    },
  });
  assert.equal(recommendations.statusCode, 200);
  assert.equal(recommendations.json().recommendations.algorithmVersion, 'v2');

  const secret = await app.inject({ method: 'GET', url: '/internal/v1/accounts/account-1/profiles/profile-1/secrets/openrouter-key' });
  assert.equal(secret.statusCode, 200);
  assert.equal(secret.json().secret.value, 'or:profile-1');

  const aiSecret = await app.inject({ method: 'GET', url: '/internal/v1/accounts/account-1/profiles/profile-1/secrets/ai-api-key' });
  assert.equal(aiSecret.statusCode, 200);
  assert.equal(aiSecret.json().secret.value, 'or:profile-1');

  const omdb = await app.inject({ method: 'GET', url: '/internal/v1/accounts/account-1/profiles/profile-1/secrets/omdb-api-key' });
  assert.equal(omdb.statusCode, 200);
  assert.equal(omdb.json().secret.value, 'secret:profile-1');

  const connection = await app.inject({ method: 'GET', url: '/internal/v1/accounts/account-1/profiles/profile-1/providers/trakt/connection' });
  assert.equal(connection.statusCode, 200);
  assert.equal(connection.json().connection.profileId, 'profile-1');

  const token = await app.inject({
    method: 'POST',
    url: '/internal/v1/accounts/account-1/profiles/profile-1/providers/trakt/access-token',
    payload: { forceRefresh: true },
  });
  assert.equal(token.statusCode, 200);
  assert.equal(token.json().accessToken.refreshed, true);
});

test('internal account lookup rejects missing email', async (t) => {
  const { registerInternalAccountRoutes } = await import('./internal-accounts.js');
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');

  const app = Fastify();
  app.decorateRequest('auth');
  app.decorate('requireServiceAuth', async () => {});
  app.decorate('requireScopes', () => {});
  app.decorate('requireAuth', async () => {});
  app.decorate('requireUserActor', () => ({
    type: 'user',
    appUserId: 'user-1',
    serviceId: null,
    scopes: [],
    authSubject: 'auth-subject',
    email: 'test@example.com',
    tokenId: null,
    consumerId: null,
  }));
  await app.register(errorHandlerPlugin);
  await registerInternalAccountRoutes(app);
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({ method: 'GET', url: '/internal/v1/accounts/by-email/%20' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'email is required.');
});
