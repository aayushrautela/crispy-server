import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HttpError } = await import('../../lib/errors.js');
const { ProviderTokenAccessService } = await import('./provider-token-access.service.js');

const noopTransaction = async <T>(work: (client: never) => Promise<T>): Promise<T> => work({} as never);

const connectedSession = {
  profileId: 'profile-1',
  provider: 'trakt',
  state: 'connected',
  providerAccountId: null,
  providerUserId: 'user-1',
  externalUsername: 'crispy',
  credentialsJson: { accessToken: 'test-access-token', accessTokenExpiresAt: null },
  stateToken: null,
  expiresAt: null,
  lastRefreshAt: null,
  lastRefreshError: null,
  lastImportCompletedAt: null,
  disconnectedAt: null,
  createdAt: '2026-04-14T15:20:00.000Z',
  updatedAt: '2026-04-14T15:20:00.000Z',
};

test('getAccessTokenForAccountProfile throws 404 when profile not found', async () => {
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => null } as never,
    {} as never,
    {} as never,
    noopTransaction,
  );

  await assert.rejects(
    () => service.getAccessTokenForAccountProfile('user-1', 'profile-1', 'trakt'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});

test('getAccessTokenForAccountProfile throws 404 when no connected provider session', async () => {
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { getConnectedSession: async () => null } as never,
    {} as never,
    noopTransaction,
  );

  await assert.rejects(
    () => service.getAccessTokenForAccountProfile('user-1', 'profile-1', 'trakt'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});

test('getAccessTokenForAccountProfile returns access token when connected', async () => {
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { getConnectedSession: async () => connectedSession } as never,
    {
      refreshConnectedSession: async (providerSession: unknown) => ({ providerSession, refreshed: false }),
      getRecommendedDelayMs: () => null,
    } as never,
    noopTransaction,
  );

  const result = await service.getAccessTokenForAccountProfile('user-1', 'profile-1', 'trakt');
  assert.equal(result.accessToken, 'test-access-token');
  assert.equal(result.provider, 'trakt');
  assert.equal(result.refreshed, false);
});

test('getTokenStatusForAccountProfile returns token state', async () => {
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    {
      getConnectedSession: async () => ({
        ...connectedSession,
        provider: 'simkl',
        credentialsJson: { accessToken: 'access', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString() },
      }),
    } as never,
    { getRecommendedDelayMs: () => null } as never,
    noopTransaction,
  );

  const result = await service.getTokenStatusForAccountProfile('user-1', 'profile-1', 'simkl');
  assert.equal(result.tokenState, 'valid');
  assert.equal(result.provider, 'simkl');
});

test('getAccessTokenForAccountProfile passes force refresh through to refresh service', async () => {
  const calls: Array<{ options: { force?: boolean } | undefined }> = [];
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    {
      getConnectedSession: async () => ({
        ...connectedSession,
        credentialsJson: { accessToken: 'forced-access-token', accessTokenExpiresAt: null, refreshToken: 'refresh-token' },
      }),
    } as never,
    {
      refreshConnectedSession: async (providerSession: unknown, options?: { force?: boolean }) => {
        calls.push({ options });
        return { providerSession, refreshed: true };
      },
      getRecommendedDelayMs: () => null,
    } as never,
    noopTransaction,
  );

  const result = await service.getAccessTokenForAccountProfile('user-1', 'profile-1', 'trakt', { forceRefresh: true });
  assert.equal(result.accessToken, 'forced-access-token');
  assert.equal(result.refreshed, true);
  assert.deepEqual(calls, [{ options: { force: true } }]);
});

test('getTokenStatusForAccountProfile exposes refresh metadata fields', async () => {
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    {
      getConnectedSession: async () => ({
        ...connectedSession,
        provider: 'simkl',
        credentialsJson: {
          accessToken: 'access',
          refreshToken: 'refresh',
          accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
        lastRefreshAt: '2026-04-14T15:20:00.000Z',
        lastRefreshError: 'temporary upstream error',
      }),
    } as never,
    { getRecommendedDelayMs: () => 60000 } as never,
    noopTransaction,
  );

  const result = await service.getTokenStatusForAccountProfile('user-1', 'profile-1', 'simkl');
  assert.equal(result.canRefresh, true);
  assert.equal(result.lastRefreshAt, '2026-04-14T15:20:00.000Z');
  assert.equal(result.lastRefreshError, 'temporary upstream error');
  assert.equal(result.recommendedRefreshDelayMs, 60000);
});
