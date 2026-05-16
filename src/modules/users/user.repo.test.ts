import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

function fakeClient(overrides: Partial<{
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}> = {}) {
  return {
    query: overrides.query ?? (async () => ({ rows: [], rowCount: 0 })),
    release: () => undefined,
  };
}

test('UserRepository.findById returns null for missing', async () => {
  const { UserRepository } = await import('./user.repo.js');
  const repo = new UserRepository();
  const client = fakeClient({ query: async () => ({ rows: [] }) });
  const result = await repo.findById(client as never, 'uuid-1');
  assert.equal(result, null);
});

test('UserRepository.findById returns mapped row for found', async () => {
  const { UserRepository } = await import('./user.repo.js');
  const repo = new UserRepository();
  const row = { id: '550e8400-e29b-41d4-a716-446655440000', email: 'test@example.com', created_at: new Date('2024-01-01T00:00:00.000Z'), updated_at: new Date('2024-01-01T00:00:00.000Z'), last_seen_at: new Date('2024-01-01T00:00:00.000Z') };
  const client = fakeClient({ query: async () => ({ rows: [row] }) });
  const result = await repo.findById(client as never, '550e8400-e29b-41d4-a716-446655440000');
  assert.notEqual(result, null);
  assert.equal(result!.id, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(result!.email, 'test@example.com');
});

test('UserRepository.listByEmail returns empty for no matches', async () => {
  const { UserRepository } = await import('./user.repo.js');
  const repo = new UserRepository();
  const client = fakeClient({ query: async () => ({ rows: [] }) });
  const result = await repo.listByEmail(client as never, 'noone@example.com');
  assert.deepEqual(result, []);
});

test('UserRepository.listByEmail returns matched rows', async () => {
  const { UserRepository } = await import('./user.repo.js');
  const repo = new UserRepository();
  const row = { id: '550e8400-e29b-41d4-a716-446655440000', email: 'Test@Example.com', created_at: new Date('2024-01-01T00:00:00.000Z'), updated_at: new Date('2024-01-01T00:00:00.000Z'), last_seen_at: new Date('2024-01-01T00:00:00.000Z') };
  const queries: string[] = [];
  const client = fakeClient({
    query: async (sql, params) => {
      queries.push(sql);
      assert.deepEqual(params, ['Test@Example.com']);
      return { rows: [row] };
    },
  });
  const result = await repo.listByEmail(client as never, ' Test@Example.com ');
  assert.equal(result.length, 1);
  assert.equal(result[0].email, 'Test@Example.com');
  assert.ok(queries[0].includes('deleted_at IS NULL'), 'query should filter deleted accounts');
  assert.ok(queries[0].includes('lower(email) = lower($1)'), 'query should be case-insensitive');
});

test('UserRepository.findByAuthSubject returns null for missing', async () => {
  const { UserRepository } = await import('./user.repo.js');
  const repo = new UserRepository();
  const client = fakeClient({ query: async () => ({ rows: [] }) });
  const result = await repo.findByAuthSubject(client as never, 'missing-uuid');
  assert.equal(result, null);
});

test('UserRepository.upsertFromAuthSubject calls upsert then reselects', async () => {
  const { UserRepository } = await import('./user.repo.js');
  const repo = new UserRepository();
  let callCount = 0;
  const row = { id: '550e8400-e29b-41d4-a716-446655440000', email: 'test@example.com', created_at: new Date('2024-01-01T00:00:00.000Z'), updated_at: new Date('2024-01-01T00:00:00.000Z'), last_seen_at: new Date('2024-01-01T00:00:00.000Z') };
  const client = fakeClient({
    query: async (sql) => {
      callCount++;
      if (callCount === 1) {
        assert.ok(sql.includes('identity.upsert_account'), 'first call should be upsert');
        return { rows: [] };
      }
      assert.ok(sql.includes('identity.accounts'), 'second call should select from accounts');
      return { rows: [row] };
    },
  });
  const result = await repo.upsertFromAuthSubject(client as never, { authSubject: '550e8400-e29b-41d4-a716-446655440000', email: 'test@example.com' });
  assert.equal(callCount, 2);
  assert.equal(result.id, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(result.email, 'test@example.com');
});

test('UserRepository.upsertFromAuthSubject throws 500 if row missing after upsert', async () => {
  const { UserRepository } = await import('./user.repo.js');
  const repo = new UserRepository();
  const client = fakeClient({
    query: async () => ({ rows: [] }),
  });
  await assert.rejects(
    () => repo.upsertFromAuthSubject(client as never, { authSubject: 'some-uuid', email: 'test@example.com' }),
    (err: { statusCode?: number; message?: string }) => err.statusCode === 500 && err.message.includes('Account row not found'),
  );
});

test('UserRepository.deleteById returns false for missing', async () => {
  const { UserRepository } = await import('./user.repo.js');
  const repo = new UserRepository();
  const client = fakeClient({ query: async () => ({ rows: [], rowCount: 0 }) });
  const result = await repo.deleteById(client as never, 'missing-uuid');
  assert.equal(result, false);
});