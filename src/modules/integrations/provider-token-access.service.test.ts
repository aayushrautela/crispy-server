import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HttpError } = await import('../../lib/errors.js');
const { ProviderTokenAccessService } = await import('./provider-token-access.service.js');

const noopTransaction = async <T>(work: (client: never) => Promise<T>): Promise<T> => work({} as never);

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

test('getAccessTokenForAccountProfile throws 404 when no connected provider', async () => {
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { findLatestConnectedForProfile: async () => null } as never,
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
    {
      findLatestConnectedForProfile: async () => ({
        id: 'acct-1', profileId: 'profile-1', provider: 'trakt', status: 'connected',
        credentialsJson: { accessToken: 'test-access-token', accessTokenExpiresAt: null },
      }),
    } as never,
    {
      refreshProviderAccount: async (providerAccount: unknown) => ({ providerAccount, refreshed: false }),
      getRecommendedDelayMs: () => null,
    } as never,
    noopTransaction,
  );

  const result = await service.getAccessTokenForAccountProfile('user-1', 'profile-1', 'trakt');
  assert.equal(result.accessToken, 'test-access-token');
  assert.equal(result.provider, 'trakt');
  assert.equal(result.refreshed, false);
  assert.equal(result.providerAccountId, 'acct-1');
});

test('getTokenStatusForAccountProfile returns token state', async () => {
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    {
      findLatestConnectedForProfile: async () => ({
        id: 'acct-1', profileId: 'profile-1', provider: 'simkl', status: 'connected',
        credentialsJson: { accessToken: 'access', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString() },
      }),
    } as never,
    { getRecommendedDelayMs: () => null } as never,
    noopTransaction,
  );

  const result = await service.getTokenStatusForAccountProfile('user-1', 'profile-1', 'simkl');
  assert.equal(result.tokenState, 'valid');
  assert.equal(result.provider, 'simkl');
  assert.equal(result.providerAccountId, 'acct-1');
});

test('getAccessTokenForAccountProfile passes force refresh through to refresh service', async () => {
  const calls: Array<{ options: { force?: boolean } | undefined }> = [];
  const service = new ProviderTokenAccessService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    {
      findLatestConnectedForProfile: async () => ({
        id: 'acct-1', profileId: 'profile-1', provider: 'trakt', status: 'connected',
        credentialsJson: { accessToken: 'forced-access-token', accessTokenExpiresAt: null, refreshToken: 'refresh-token' },
      }),
    } as never,
    {
      refreshProviderAccount: async (providerAccount: unknown, options?: { force?: boolean }) => {
        calls.push({ options });
        return { providerAccount, refreshed: true };
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
      findLatestConnectedForProfile: async () => ({
        id: 'acct-1', profileId: 'profile-1', provider: 'simkl', status: 'connected',
        credentialsJson: {
          accessToken: 'access',
          refreshToken: 'refresh',
          accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          lastRefreshAt: '2026-04-14T15:20:00.000Z',
          lastRefreshError: 'temporary upstream error',
        },
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
