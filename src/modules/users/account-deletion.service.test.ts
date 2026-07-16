import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { AccountDeletionService } = await import('./account-deletion.service.js');

test('deleteAccount revokes PATs and cleans up data', async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT avatar_url')) return { rows: [], rowCount: 0 };
      if (sql.includes('DELETE FROM identity.profiles')) return { rows: [{ id: 'profile-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const service = new AccountDeletionService(
    { revokeAllForUser: async () => 3 } as never,
    { deleteById: async () => true } as never,
    { deleteUser: async () => true } as never,
    async (work) => work(client as never),
  );

  const result = await service.deleteAccount({ appUserId: 'user-1', authSubject: 'auth-1' });
  assert.equal(result.appUserId, 'user-1');
  assert.equal(result.revokedPersonalAccessTokens, 3);
  assert.equal(result.deletedProfiles, 1);
  assert.equal(result.deletedExternalAuthUser, true);
  assert.ok(queries.some((sql) => sql.includes('private.account_secrets')));
  assert.ok(queries.some((sql) => sql.includes('identity.account_preferences')));
});

test('deleteAccount includes warnings for avatar keys', async () => {
  const client = {
    query: async (sql: string) => {
      if (sql.includes('SELECT avatar_url')) return { rows: [{ avatar_url: 'https://api.dicebear.com/v9/initials/svg?seed=key-1' }, { avatar_url: 'https://api.dicebear.com/v9/initials/svg?seed=key-2' }], rowCount: 2 };
      if (sql.includes('DELETE FROM identity.profiles')) return { rows: [{ id: 'profile-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const service = new AccountDeletionService(
    { revokeAllForUser: async () => 0 } as never,
    { deleteById: async () => true } as never,
    { deleteUser: async () => false } as never,
    async (work) => work(client as never),
  );

  const result = await service.deleteAccount({ appUserId: 'user-1', authSubject: null });
  assert.equal(result.deletedProfiles, 1);
  assert.equal(result.deletedExternalAuthUser, false);
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings[0]?.includes('avatar'));
});
