import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/crispy_test';
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  process.env.AUTH_JWKS_URL ||= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.AUTH_JWT_ISSUER ||= 'https://example.supabase.co/auth/v1';
  process.env.AUTH_JWT_AUDIENCE ||= 'authenticated';
  process.env.TMDB_API_KEY ||= 'tmdb-key';
  process.env.SERVICE_CLIENTS_JSON ||= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

test('deleteAccount transfers shared households and warns about avatar cleanup for deleted households', async () => {
  seedTestEnv();
  const { AccountDeletionService } = await import('./account-deletion.service.js');
  const { db } = await import('../../lib/db.js');

  const originalConnect = db.connect.bind(db);
  const queries: string[] = [];

  (db as { connect: typeof db.connect }).connect = async () => ({
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() {
      return undefined;
    },
  } as never);

  const personalAccessTokenService = {
    revokeAllForUser: async (userId: string) => {
      assert.equal(userId, 'user-1');
      return 2;
    },
  };
  const householdRepository = {
    findOwnedHouseholdIds: async () => ['household-shared', 'household-empty'],
    listMembers: async (_client: unknown, householdId: string) => {
      if (householdId === 'household-shared') {
        return [
          { userId: 'user-1', role: 'owner' },
          { userId: 'user-2', role: 'member' },
        ];
      }
      return [{ userId: 'user-1', role: 'owner' }];
    },
    transferOwnership: async (_client: unknown, params: { householdId: string; nextOwnerUserId: string }) => {
      assert.deepEqual(params, {
        householdId: 'household-shared',
        nextOwnerUserId: 'user-2',
      });
    },
    deleteById: async (_client: unknown, householdId: string) => {
      assert.equal(householdId, 'household-empty');
      return true;
    },
  };
  const profileRepository = {
    listAvatarKeysForHouseholds: async (_client: unknown, householdIds: string[]) => {
      assert.deepEqual(householdIds, ['household-empty']);
      return ['avatar-a', 'avatar-b'];
    },
  };
  const accountSettingsRepository = {};
  const userRepository = {
    deleteById: async (_client: unknown, userId: string) => {
      assert.equal(userId, 'user-1');
      return true;
    },
  };
  const externalAuthAdminService = {
    deleteUser: async (authSubject: string) => {
      assert.equal(authSubject, 'auth-user-1');
      return true;
    },
  };

  try {
    const service = new AccountDeletionService(
      personalAccessTokenService as never,
      householdRepository as never,
      profileRepository as never,
      accountSettingsRepository as never,
      userRepository as never,
      externalAuthAdminService as never,
    );

    const result = await service.deleteAccount({
      appUserId: 'user-1',
      authSubject: 'auth-user-1',
    });

    assert.deepEqual(result, {
      appUserId: 'user-1',
      deletedOwnedHouseholds: 1,
      transferredOwnedHouseholds: 1,
      revokedPersonalAccessTokens: 2,
      deletedExternalAuthUser: true,
      warnings: [
        'Deleted household household-empty referenced 2 avatar key(s), but avatar storage cleanup is not configured locally.',
      ],
    });
    assert.deepEqual(queries, [
      'BEGIN',
      'DELETE FROM account_secrets WHERE app_user_id = $1::uuid',
      'DELETE FROM account_settings WHERE app_user_id = $1::uuid',
      'COMMIT',
    ]);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});
