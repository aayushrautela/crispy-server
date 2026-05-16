import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const fakeQueryResult: { rows: Record<string, unknown>[]; rowCount?: number | null } = { rows: [] };

async function withMockedDb(fn: () => Promise<void>) {
  const { db } = await import('../../lib/db.js');
  const originalConnect = db.connect.bind(db);
  db.connect = (async () => ({
    query: async () => fakeQueryResult,
    release: () => undefined,
  })) as never;
  try {
    await fn();
  } finally {
    db.connect = originalConnect;
  }
}

function createMockRepo(overrides: Partial<{
  findById: (client: unknown, userId: string) => unknown;
  listByEmail: (client: unknown, email: string) => unknown;
  findByAuthSubject: (client: unknown, authSubject: string) => unknown;
  upsertFromAuthSubject: (client: unknown, params: { authSubject: string; email: string | null }) => unknown;
  deleteById: (client: unknown, userId: string) => unknown;
}> = {}) {
  return {
    findById: overrides.findById ?? (async () => null),
    listByEmail: overrides.listByEmail ?? (async () => []),
    findByAuthSubject: overrides.findByAuthSubject ?? (async () => null),
    upsertFromAuthSubject: overrides.upsertFromAuthSubject ?? (async () => { throw new Error('not mocked'); }),
    deleteById: overrides.deleteById ?? (async () => false),
  };
}

test('AccountLookupService.getByEmail returns account for single match', async (t) => {
  await withMockedDb(async () => {
    const { AccountLookupService } = await import('./account-lookup.service.js');
    const mockUser = { id: 'uuid-1', authSubject: 'uuid-1', email: 'test@example.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z' };
    const mockRepo = createMockRepo({
      listByEmail: async (_client, email) => {
        assert.equal(email, 'test@example.com');
        return [mockUser];
      },
    });
    const svc = new AccountLookupService(mockRepo as never);
    const result = await svc.getByEmail('test@example.com');
    assert.equal(result.accountId, 'uuid-1');
    assert.equal(result.email, 'test@example.com');
  });
});

test('AccountLookupService.getByEmail throws 404 for missing email', async (t) => {
  await withMockedDb(async () => {
    const { AccountLookupService } = await import('./account-lookup.service.js');
    const mockRepo = createMockRepo({ listByEmail: async () => [] });
    const svc = new AccountLookupService(mockRepo as never);
    await assert.rejects(
      () => svc.getByEmail('missing@example.com'),
      (err: { statusCode?: number; message?: string }) => err.statusCode === 404 && err.message === 'Account not found for email.',
    );
  });
});

test('AccountLookupService.getByEmail throws 409 for multiple matches', async (t) => {
  await withMockedDb(async () => {
    const { AccountLookupService } = await import('./account-lookup.service.js');
    const mockUser = { id: 'uuid-1', authSubject: 'uuid-1', email: 'test@example.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z' };
    const mockRepo = createMockRepo({
      listByEmail: async () => [mockUser, { ...mockUser, id: 'uuid-2' }],
    });
    const svc = new AccountLookupService(mockRepo as never);
    await assert.rejects(
      () => svc.getByEmail('test@example.com'),
      (err: { statusCode?: number; message?: string }) => err.statusCode === 409,
    );
  });
});

test('AccountLookupService.getByEmail trims whitespace from email', async (t) => {
  await withMockedDb(async () => {
    const { AccountLookupService } = await import('./account-lookup.service.js');
    const calledWith: string[] = [];
    const mockRepo = createMockRepo({
      listByEmail: async (_client, email) => {
        calledWith.push(email);
        return [];
      },
    });
    const svc = new AccountLookupService(mockRepo as never);
    await assert.rejects(() => svc.getByEmail('  Test@Example.com  '));
    assert.equal(calledWith[0], 'Test@Example.com');
  });
});

test('AccountLookupService.getByEmail throws 400 for empty email', async (t) => {
  await withMockedDb(async () => {
    const { AccountLookupService } = await import('./account-lookup.service.js');
    const mockRepo = createMockRepo();
    const svc = new AccountLookupService(mockRepo as never);
    await assert.rejects(
      () => svc.getByEmail(''),
      (err: { statusCode?: number; message?: string }) => err.statusCode === 400 && err.message === 'email is required.',
    );
    await assert.rejects(
      () => svc.getByEmail('   '),
      (err: { statusCode?: number; message?: string }) => err.statusCode === 400,
    );
  });
});

test('AccountLookupService.getById returns account for found ID', async (t) => {
  await withMockedDb(async () => {
    const { AccountLookupService } = await import('./account-lookup.service.js');
    const mockUser = { id: 'uuid-1', authSubject: 'uuid-1', email: 'test@example.com', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z' };
    const mockRepo = createMockRepo({
      findById: async (_client, userId) => {
        assert.equal(userId, 'uuid-1');
        return mockUser;
      },
    });
    const svc = new AccountLookupService(mockRepo as never);
    const result = await svc.getById('uuid-1');
    assert.equal(result.accountId, 'uuid-1');
    assert.equal(result.email, 'test@example.com');
  });
});

test('AccountLookupService.getById throws 404 for missing ID', async (t) => {
  await withMockedDb(async () => {
    const { AccountLookupService } = await import('./account-lookup.service.js');
    const mockRepo = createMockRepo({ findById: async () => null });
    const svc = new AccountLookupService(mockRepo as never);
    await assert.rejects(
      () => svc.getById('missing-uuid'),
      (err: { statusCode?: number; message?: string }) => err.statusCode === 404 && err.message === 'Account not found.',
    );
  });
});