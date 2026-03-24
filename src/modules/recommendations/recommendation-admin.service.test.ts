import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.SUPABASE_JWKS_URL ??= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.SUPABASE_JWT_ISSUER ??= 'https://example.supabase.co/auth/v1';
  process.env.SUPABASE_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

async function loadService() {
  seedTestEnv();
  return import('./recommendation-admin.service.js');
}

test('listConsumers returns consumer diagnostics', async () => {
  const { RecommendationAdminService } = await loadService();
  const service = new RecommendationAdminService(
    {
      listAll: async (_client: unknown, limit: number) => {
        assert.equal(limit, 50);
        return [{ id: 'consumer-1', consumerKey: 'service:engine', ownerKind: 'service', ownerUserId: null, displayName: 'Engine', sourceKey: 'engine', isInternal: true, status: 'active', createdAt: 'a', updatedAt: 'b', activeLeaseCount: 1, trackedProfileCount: 2, latestWorkStateUpdatedAt: 'c' }];
      },
    } as never,
    {} as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.listConsumers(50);
  assert.equal(result.consumers.length, 1);
  assert.equal(result.consumers[0]?.consumerKey, 'service:engine');
});

test('getWorkState combines active, stale, and backlog diagnostics', async () => {
  const { RecommendationAdminService } = await loadService();
  const service = new RecommendationAdminService(
    {} as never,
    {
      listActiveLeases: async () => [{ consumerId: 'c1', consumerKey: 'svc', displayName: 'Svc', sourceKey: 'svc', profileId: 'p1', profileName: 'Main', leaseId: 'l1', leaseOwner: 'w1', leaseExpiresAt: '2026-03-24T00:00:00.000Z', claimedHistoryGeneration: 3, pendingEventCount: 4, updatedAt: '2026-03-24T00:00:00.000Z' }],
      listStaleLeases: async () => [{ consumerId: 'c2', consumerKey: 'svc2', displayName: 'Svc2', sourceKey: 'svc2', profileId: 'p2', profileName: 'Kids', leaseId: 'l2', leaseOwner: 'w2', leaseExpiresAt: '2026-03-23T00:00:00.000Z', claimedHistoryGeneration: 2, pendingEventCount: 1, updatedAt: '2026-03-23T00:00:00.000Z' }],
      listBacklogSummaries: async () => [{ consumerId: 'c1', consumerKey: 'svc', displayName: 'Svc', sourceKey: 'svc', pendingProfileCount: 1, pendingEventCount: 4, oldestOccurredAt: '2026-03-24T00:00:00.000Z', newestEventId: 11 }],
    } as never,
    {} as never,
    async (work) => work({} as never),
  );

  const result = await service.getWorkState();
  assert.equal(result.activeLeases.length, 1);
  assert.equal(result.staleLeases.length, 1);
  assert.equal(result.backlog[0]?.pendingEventCount, 4);
});

test('getOutbox combines lag and undelivered events', async () => {
  const { RecommendationAdminService } = await loadService();
  const service = new RecommendationAdminService(
    {} as never,
    {} as never,
    {
      getLagSummary: async () => ({ undeliveredCount: 3, oldestOccurredAt: '2026-03-24T00:00:00.000Z', oldestCreatedAt: '2026-03-24T00:01:00.000Z', newestCreatedAt: '2026-03-24T00:02:00.000Z' }),
      listUndelivered: async () => [{ id: 1, profileId: 'p1', historyGeneration: 1, eventType: 'watch.updated', mediaKey: null, mediaType: null, tmdbId: null, showTmdbId: null, seasonNumber: null, episodeNumber: null, rating: null, occurredAt: '2026-03-24T00:00:00.000Z', payload: {}, createdAt: '2026-03-24T00:01:00.000Z', deliveredAt: null }],
    } as never,
    async (work) => work({} as never),
  );

  const result = await service.getOutbox();
  assert.equal(result.lag.undeliveredCount, 3);
  assert.equal(result.undelivered[0]?.id, 1);
});
