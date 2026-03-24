import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.AUTH_JWKS_URL ??= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.AUTH_JWT_ISSUER ??= 'https://example.supabase.co/auth/v1';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

async function loadResolverService(): Promise<typeof import('./tmdb-external-id-resolver.service.js').TmdbExternalIdResolverService> {
  seedTestEnv();
  const module = await import('./tmdb-external-id-resolver.service.js');
  return module.TmdbExternalIdResolverService;
}

test('resolve returns cached TMDB id when external id already exists', async () => {
  const TmdbExternalIdResolverService = await loadResolverService();
  let findCalls = 0;

  const service = new TmdbExternalIdResolverService(
    {
      findByExternalId: async () => ({
        source: 'imdb_id',
        externalId: 'tt123',
        mediaType: 'movie',
        tmdbId: 55,
        raw: {},
        createdAt: '2026-03-22T00:00:00.000Z',
        updatedAt: '2026-03-22T00:00:00.000Z',
      }),
      upsert: async () => {
        throw new Error('upsert should not be called on cache hit');
      },
    } as never,
    {
      findByExternalId: async () => {
        findCalls += 1;
        return {};
      },
    } as never,
  );

  const resolved = await service.resolve({} as never, {
    source: 'imdb_id',
    externalId: 'tt123',
    mediaType: 'movie',
  });

  assert.equal(resolved, 55);
  assert.equal(findCalls, 0);
});

test('resolve fetches TMDB find results and stores normalized show mapping', async () => {
  const TmdbExternalIdResolverService = await loadResolverService();
  const upserts: Array<Record<string, unknown>> = [];

  const service = new TmdbExternalIdResolverService(
    {
      findByExternalId: async () => null,
      upsert: async (_client: unknown, params: Record<string, unknown>) => {
        upserts.push(params);
        return {
          source: String(params.source),
          externalId: String(params.externalId),
          mediaType: String(params.mediaType),
          tmdbId: Number(params.tmdbId),
          raw: (params.raw as Record<string, unknown> | undefined) ?? {},
          createdAt: '2026-03-22T00:00:00.000Z',
          updatedAt: '2026-03-22T00:00:00.000Z',
        };
      },
    } as never,
    {
      findByExternalId: async () => ({
        tv_results: [
          {
            id: 777,
            name: 'Example Show',
          },
        ],
      }),
    } as never,
  );

  const resolved = await service.resolve({} as never, {
    source: 'tvdb_id',
    externalId: '12345',
    mediaType: 'show',
  });

  assert.equal(resolved, 777);
  assert.deepEqual(upserts, [
    {
      source: 'tvdb_id',
      externalId: '12345',
      mediaType: 'tv',
      tmdbId: 777,
      raw: {
        id: 777,
        name: 'Example Show',
      },
    },
  ]);
});
