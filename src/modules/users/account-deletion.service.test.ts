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
      if (sql.includes('DELETE FROM identity.profiles')) return { rows: [{ id: 'profile-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const service = new AccountDeletionService(
    { revokeAllForUser: async () => 3 } as never,
    { deleteById: async () => true, deleteAuthUser: async () => true } as never,
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
  assert.equal(result.warnings.length, 0);
});