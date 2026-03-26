import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { AccountDeletionService } = await import('./account-deletion.service.js');

test('deleteAccount revokes PATs and cleans up data', async () => {
  const service = new AccountDeletionService(
    { revokeAllForUser: async () => 3 } as never,
    { findOwnedProfileGroupIds: async () => [], deleteById: async () => true } as never,
    { listAvatarKeysForProfileGroups: async () => [] } as never,
    {} as never,
    { deleteById: async () => true } as never,
    { deleteUser: async () => true } as never,
  );

  const result = await service.deleteAccount({ appUserId: 'user-1', authSubject: 'auth-1' });
  assert.equal(result.appUserId, 'user-1');
  assert.equal(result.revokedPersonalAccessTokens, 3);
  assert.equal(result.deletedExternalAuthUser, true);
});

test('deleteAccount transfers ownership when other members exist', async () => {
  let transferredTo: string | null = null;
  const service = new AccountDeletionService(
    { revokeAllForUser: async () => 0 } as never,
    {
      findOwnedProfileGroupIds: async () => ['group-1'],
      listMembers: async () => [
        { userId: 'user-1', role: 'owner' },
        { userId: 'user-2', role: 'member' },
      ],
      transferOwnership: async (_client: unknown, params: { nextOwnerUserId: string }) => {
        transferredTo = params.nextOwnerUserId;
      },
    } as never,
    {} as never,
    {} as never,
    { deleteById: async () => true } as never,
    { deleteUser: async () => false } as never,
  );

  const result = await service.deleteAccount({ appUserId: 'user-1', authSubject: null });
  assert.equal(result.transferredProfileGroups, 1);
  assert.equal(transferredTo, 'user-2');
  assert.equal(result.deletedExternalAuthUser, false);
});

test('deleteAccount deletes empty profile groups', async () => {
  const service = new AccountDeletionService(
    { revokeAllForUser: async () => 0 } as never,
    {
      findOwnedProfileGroupIds: async () => ['group-1'],
      listMembers: async () => [{ userId: 'user-1', role: 'owner' }],
      deleteById: async () => true,
    } as never,
    { listAvatarKeysForProfileGroups: async () => [] } as never,
    {} as never,
    { deleteById: async () => true } as never,
    { deleteUser: async () => false } as never,
  );

  const result = await service.deleteAccount({ appUserId: 'user-1', authSubject: null });
  assert.equal(result.deletedProfileGroups, 1);
  assert.equal(result.transferredProfileGroups, 0);
});

test('deleteAccount includes warnings for avatar keys', async () => {
  const service = new AccountDeletionService(
    { revokeAllForUser: async () => 0 } as never,
    {
      findOwnedProfileGroupIds: async () => ['group-1'],
      listMembers: async () => [{ userId: 'user-1', role: 'owner' }],
      deleteById: async () => true,
    } as never,
    { listAvatarKeysForProfileGroups: async () => ['key-1', 'key-2'] } as never,
    {} as never,
    { deleteById: async () => true } as never,
    { deleteUser: async () => false } as never,
  );

  const result = await service.deleteAccount({ appUserId: 'user-1', authSubject: null });
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings[0]?.includes('avatar'));
});
