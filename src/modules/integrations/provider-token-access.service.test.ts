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
