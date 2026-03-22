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
}

test('searchTitles returns empty when query is blank', async () => {
  seedTestEnv();
  const pkg = await import('./metadata-query.service.js');
  const svc = new pkg.MetadataQueryService(
    {
      buildViews: async () => [],
    } as never,
    null as never,
    {
      searchTitles: async () => [],
      getTitle: async () => null,
      ensureSeasonCached: async () => null,
      listEpisodesForShow: async () => [],
    } as never,
  );

  const response = await svc.searchTitles('   ', 10);
  assert.deepEqual(response, { query: '', items: [] });
});

test('resolve uses tmdbId directly without transaction', async () => {
  seedTestEnv();
  const pkg = await import('./metadata-query.service.js');

  const title: any = {
    mediaType: 'movie' as const,
    tmdbId: 77,
    name: 'Test Show',
    originalName: 'Test Show',
    overview: null,
    releaseDate: null,
    firstAirDate: null,
    status: null,
    posterPath: null,
    backdropPath: null,
    runtime: null,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    raw: {},
    fetchedAt: '',
    expiresAt: '',
  };

  const mockTmdbCacheService = {
    searchTitles: async () => [],
    getTitle: async (client: unknown, mediaType: string, tmdbId: number) => (tmdbId === 77 ? title : null),
    ensureSeasonCached: async () => null,
    listEpisodesForShow: async () => [],
  };

  const mockExternalResolver = { resolve: async (client: unknown, params: unknown) => params };
  const mockViewService = {
    buildMetadataView: async (client: unknown, identity: { tmdbId: number }) =>
      identity.tmdbId === 77
        ? ({
            id: 'crisp:movie:77',
            title: 'Test Show',
            mediaType: 'movie' as const,
            kind: 'title' as const,
            tmdbId: 77,
            showTmdbId: null,
            seasonNumber: null,
            episodeNumber: null,
            subtitle: null,
            summary: null,
            overview: null,
            artwork: { posterUrl: null, backdropUrl: null, stillUrl: null as string | null },
            images: { posterUrl: null, backdropUrl: null, stillUrl: null as string | null, logoUrl: null as string | null },
            releaseDate: null,
            releaseYear: null as number | null,
            runtimeMinutes: null as number | null,
            rating: null as number | null,
            certification: null as string | null,
            status: null as string | null,
            genres: [],
            externalIds: { tmdb: 77, imdb: null as string | null, tvdb: null as number | null },
            seasonCount: null as number | null,
            episodeCount: null as number | null,
            nextEpisode: null,
          })
        : null,
  };

  const svc = new pkg.MetadataQueryService(
    mockViewService as never,
    mockExternalResolver as never,
    mockTmdbCacheService as never,
  );

  const input = { tmdbId: 77, mediaType: 'movie' as const };
  
  const identity = await (svc as any).resolveIdentity(null, input);
  assert.equal(identity.tmdbId, 77);
  assert.equal(identity.mediaType, 'movie');
});

test('resolve handles imdb external id', async () => {
  seedTestEnv();
  const pkg = await import('./metadata-query.service.js');

  let resolverCalledWith: unknown = null;
  const mockExternalResolver = {
    resolve: async (client: unknown, params: unknown) => {
      resolverCalledWith = params;
      return 88;
    },
  };

  const mockTmdbCacheService = {
    searchTitles: async () => [],
    getTitle: async () => null,
    ensureSeasonCached: async () => null,
    listEpisodesForShow: async () => [],
  };
  const mockViewService = { buildMetadataView: async () => null };

  const svc = new pkg.MetadataQueryService(
    mockViewService as never,
    mockExternalResolver as never,
    mockTmdbCacheService as never,
  );

  const input = { imdbId: 'tt9999', mediaType: 'show' as const };
  const tmdbId = await (svc as any).resolveTmdbId(null, input, 'show' as const);
  
  assert.equal(tmdbId, 88);
  assert.deepEqual(resolverCalledWith, { source: 'imdb_id', externalId: 'tt9999', mediaType: 'show' });
});

test('resolve rejects episode without season/episode numbers', async () => {
  seedTestEnv();
  const pkg = await import('./metadata-query.service.js');

  const mockTmdbCacheService = {
    searchTitles: async () => [],
    getTitle: async () => null,
    ensureSeasonCached: async () => null,
    listEpisodesForShow: async () => [],
  };
  const mockExternalResolver = { resolve: async (client: unknown) => 42 };
  const mockViewService = { buildMetadataView: async () => null };

  const svc = new pkg.MetadataQueryService(
    mockViewService as never,
    mockExternalResolver as never,
    mockTmdbCacheService as never,
  );

  await assert.rejects(
    async () => (svc as any).resolveIdentity(null, { tmdbId: 42, mediaType: 'episode' as const }),
    (error: unknown) => error instanceof Error && /Episode resolution requires/.test(error.message),
  );
});

test('resolve rejects missing tmdb id for movie/show', async () => {
  seedTestEnv();
  const pkg = await import('./metadata-query.service.js');

  const mockTmdbCacheService = {
    searchTitles: async () => [],
    getTitle: async () => null,
    ensureSeasonCached: async () => null,
    listEpisodesForShow: async () => [],
  };
  const mockExternalResolver = { resolve: async () => null };
  const mockViewService = { buildMetadataView: async () => null };

  const svc = new pkg.MetadataQueryService(
    mockViewService as never,
    mockExternalResolver as never,
    mockTmdbCacheService as never,
  );

  await assert.rejects(
    async () => (svc as any).resolveIdentity(null, { imdbId: 'tt9999', mediaType: 'movie' as const }),
    (error: unknown) => error instanceof Error && /Unable to resolve/.test(error.message),
  );
});
