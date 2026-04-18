import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-client-id', TRAKT_IMPORT_CLIENT_SECRET: 'trakt-client-secret', TRAKT_IMPORT_REDIRECT_URI: 'https://api.crispytv.tech/v1/imports/trakt/callback' });

const noopTransaction = async <T>(work: (client: never) => Promise<T>): Promise<T> => work({} as never);

test('buildAuthUrl uses trakt.tv authorize host', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const authUrl = (service as any).buildAuthUrl('trakt', 'state-123', 'challenge-abc');

  const url = new URL(authUrl);
  assert.equal(url.origin, 'https://trakt.tv');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'trakt-client-id');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('exchangeTraktAuthorizationCode includes details for non-json failures', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } })) as typeof fetch;

  try {
    const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await assert.rejects(
      () => (service as any).exchangeTraktAuthorizationCode('code-123', 'verifier-123'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 403);
        assert.equal(error.message, 'Unable to exchange the Trakt authorization code.');
        assert.deepEqual(error.details, { provider: 'trakt', providerStatus: 403, responseBody: 'blocked' });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('traktGetArray includes upstream response details for import failures', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: 'invalid_grant' }, { status: 401 })) as typeof fetch;

  try {
    const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await assert.rejects(
      () => (service as any).traktGetArray('/sync/history', 'access-123'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 401);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('disconnectConnection revokes trakt upstream before local disconnect', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');

  const profileRepository = {
    findByIdForOwnerUser: async () => ({ id: 'profile-1' }),
  };
  const providerAccount = {
    id: 'acct-1',
    profileId: 'profile-1',
    provider: 'trakt',
    status: 'connected',
    stateToken: null,
    providerUserId: 'user-1',
    externalUsername: 'crispy',
    credentialsJson: { refreshToken: 'refresh-123', accessToken: 'access-123' },
    createdByUserId: 'account-1',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: '2026-03-24T00:00:00.000Z',
    connectedAt: '2026-03-24T00:05:00.000Z',
    updatedAt: '2026-03-26T00:00:00.000Z',
  };
  const providerAccountsRepository = {
    findLatestConnectedForProfile: async () => providerAccount,
    revokeProviderAccount: async (_client: unknown, params: { credentialsJson?: Record<string, unknown>; lastUsedAt?: string | null }) => ({
      ...providerAccount,
      status: 'revoked',
      credentialsJson: params.credentialsJson ?? {},
      lastUsedAt: params.lastUsedAt ?? null,
    }),
  };

  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; body: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return new Response('', { status: 200 });
  }) as typeof fetch;

  try {
    const service = new ProviderImportService(
      profileRepository as never,
      providerAccountsRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noopTransaction as never,
    );

    const result = await service.disconnectProviderSession('account-1', 'profile-1', 'trakt');
    assert.equal(result.providerState.connectionState, 'not_connected');
    assert.equal(result.providerState.primaryAction, 'connect');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'https://api.trakt.tv/oauth/revoke');
    assert.match(fetchCalls[0]?.body ?? '', /"token":"refresh-123"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('disconnectProviderSession surfaces trakt revoke failures', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const profileRepository = {
    findByIdForOwnerUser: async () => ({ id: 'profile-1' }),
  };
  const providerAccountsRepository = {
    findLatestConnectedForProfile: async () => ({
      id: 'acct-1',
      profileId: 'profile-1',
      provider: 'trakt',
      status: 'connected',
      stateToken: null,
      providerUserId: 'user-1',
      externalUsername: 'crispy',
      credentialsJson: { refreshToken: 'refresh-123' },
      createdByUserId: 'account-1',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: '2026-03-24T00:00:00.000Z',
      connectedAt: '2026-03-24T00:05:00.000Z',
      updatedAt: '2026-03-26T00:00:00.000Z',
    }),
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } })) as typeof fetch;

  try {
    const service = new ProviderImportService(
      profileRepository as never,
      providerAccountsRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noopTransaction as never,
    );

    await assert.rejects(
      () => service.disconnectProviderSession('account-1', 'profile-1', 'trakt'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 403);
        assert.equal(error.message, 'Unable to revoke the Trakt authorization.');
        assert.deepEqual(error.details, { provider: 'trakt', providerStatus: 403, responseBody: 'blocked' });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchAndNormalizeTraktImport keeps show tmdb ids on watchlist and ratings', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { inferMediaIdentity } = await import('../identity/media-key.js');

  const service = new ProviderImportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      resolve: async () => 9001,
    } as never,
    {} as never,
  );
  (service as any).resolveImportIdentity = async (_cache: unknown, params: { tvdbId?: string | null }) => {
    if (params.tvdbId !== '121361') {
      return null;
    }

    const identity = inferMediaIdentity({
      mediaType: 'show',
      tmdbId: 9001,
      providerMetadata: { tmdbId: 9001 },
    });

    return {
      identity,
      mediaType: 'show',
      tmdbId: 9001,
      tvdbId: 121361,
      kitsuId: null,
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/sync/watched/movies')) {
      return Response.json([]);
    }
    if (url.endsWith('/sync/watched/shows')) {
      return Response.json([]);
    }
    if (url.endsWith('/sync/watchlist/movies')) {
      return Response.json([]);
    }
    if (url.endsWith('/sync/watchlist/shows')) {
      return Response.json([{
        listed_at: '2024-01-02T00:00:00.000Z',
        show: { ids: { imdb: 'tt0944947', tvdb: 121361 } },
      }]);
    }
    if (url.endsWith('/sync/ratings/movies')) {
      return Response.json([]);
    }
    if (url.endsWith('/sync/ratings/shows')) {
      return Response.json([{
        rated_at: '2024-01-03T00:00:00.000Z',
        rating: 9,
        show: { ids: { imdb: 'tt0944947', tvdb: 121361 } },
      }]);
    }
    if (url.endsWith('/sync/playback')) {
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  try {
    const result = await (service as any).fetchAndNormalizeTraktImport(
      { id: 'job-1' },
      { credentialsJson: { accessToken: 'token-123' } },
    );

    const watchlistEvent = result.importedEvents.find((entry: any) => entry.eventType === 'watchlist_put');
    const ratingEvent = result.importedEvents.find((entry: any) => entry.eventType === 'rating_put');

    assert.equal(watchlistEvent.showTmdbId, 9001);
    assert.equal(ratingEvent.showTmdbId, 9001);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchAndNormalizeTraktImport carries show tmdb ids into episode playback events', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { inferMediaIdentity } = await import('../identity/media-key.js');

  const service = new ProviderImportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      resolve: async () => 777,
    } as never,
    {} as never,
  );
  (service as any).resolveImportIdentity = async (_cache: unknown, params: { tvdbId?: string | null }) => {
    if (params.tvdbId !== '121361') {
      return null;
    }

    const identity = inferMediaIdentity({
      mediaType: 'show',
      tmdbId: 777,
      providerMetadata: { tmdbId: 777 },
    });

    return {
      identity,
      mediaType: 'show',
      tmdbId: 777,
      tvdbId: 121361,
      kitsuId: null,
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/sync/playback')) {
      return Response.json([{
        id: 55,
        type: 'episode',
        progress: 25,
        paused_at: '2024-01-04T00:00:00.000Z',
        show: { ids: { imdb: 'tt0944947', tvdb: 121361 } },
        episode: { season: 2, number: 3, runtime: 60 },
      }]);
    }
    return Response.json([]);
  }) as typeof fetch;

  try {
    const result = await (service as any).fetchAndNormalizeTraktImport(
      { id: 'job-1' },
      { credentialsJson: { accessToken: 'token-123' } },
    );

    assert.equal(result.importedEvents.length, 1);
    assert.deepEqual(result.importedEvents[0], {
      eventType: 'playback_progress_snapshot',
      mediaKey: 'episode:tmdb:777:2:3',
      mediaType: 'episode',
      provider: 'tmdb',
      providerId: '777:s2:e3',
      parentProvider: 'tmdb',
      parentProviderId: '777',
      tmdbId: 777,
      tvdbId: 121361,
      kitsuId: null,
      showTmdbId: 777,
      seasonNumber: 2,
      episodeNumber: 3,
      absoluteEpisodeNumber: null,
      positionSeconds: 900,
      durationSeconds: 3600,
      occurredAt: '2024-01-04T00:00:00.000Z',
      payload: {
        provider: 'trakt',
        source: 'playback',
        playbackId: '55',
        progressPercent: 25,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchAndNormalizeTraktImport keeps Trakt playback progress without runtime', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { inferMediaIdentity } = await import('../identity/media-key.js');

  const service = new ProviderImportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      resolve: async () => 272,
    } as never,
    {} as never,
  );
  (service as any).resolveImportIdentity = async (_cache: unknown, params: { tmdbId?: number | null }) => {
    if (params.tmdbId !== 272) {
      return null;
    }

    const identity = inferMediaIdentity({
      mediaType: 'movie',
      provider: 'tmdb',
      providerId: '272',
      tmdbId: 272,
      providerMetadata: { tmdbId: 272 },
    });

    return {
      identity,
      mediaType: 'movie',
      tmdbId: 272,
      tvdbId: null,
      kitsuId: null,
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/sync/playback')) {
      return Response.json([{
        id: 13,
        type: 'movie',
        progress: 10,
        paused_at: '2015-01-25T22:01:32.000Z',
        movie: {
          title: 'Batman Begins',
          year: 2005,
          ids: {
            trakt: 1,
            slug: 'batman-begins-2005',
            imdb: 'tt0372784',
            tmdb: 272,
          },
        },
      }]);
    }
    return Response.json([]);
  }) as typeof fetch;

  try {
    const result = await (service as any).fetchAndNormalizeTraktImport(
      { id: 'job-1' },
      { credentialsJson: { accessToken: 'token-123' } },
    );

    assert.equal(result.importedEvents.length, 1);
    assert.deepEqual(result.importedEvents[0], {
      eventType: 'playback_progress_snapshot',
      mediaKey: 'movie:tmdb:272',
      mediaType: 'movie',
      provider: 'tmdb',
      providerId: '272',
      tmdbId: 272,
      tvdbId: null,
      kitsuId: null,
      showTmdbId: null,
      rating: null,
      positionSeconds: null,
      durationSeconds: null,
      occurredAt: '2015-01-25T22:01:32.000Z',
      payload: {
        provider: 'trakt',
        source: 'playback',
        playbackId: '13',
        progressPercent: 10,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveImportIdentity keeps direct trakt tmdb id for movies when tmdb lookup succeeds', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { db } = await import('../../lib/db.js');

  const resolverCalls: Array<Record<string, unknown>> = [];
  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({ release: () => {} }) as never;

  const service = new ProviderImportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      resolve: async (_client: unknown, params: Record<string, unknown>) => {
        resolverCalls.push(params);
        return 272;
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    async <T>(work: (client: never) => Promise<T>) => work({} as never),
    {
      getTitle: async () => ({ tmdbId: 328443 }),
    } as never,
    {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  );

  try {
    const result = await (service as any).resolveImportIdentity(new Map(), {
      mediaFamily: 'movie',
      tmdbId: 328443,
      imdbId: 'tt0372784',
    });

    assert.equal(resolverCalls.length, 0);
    assert.equal(result.identity.mediaKey, 'movie:tmdb:328443');
    assert.equal(result.identity.providerId, '328443');
    assert.equal(result.tmdbId, 328443);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});

test('resolveImportIdentity falls back to imdb canonicalization when direct trakt tmdb lookup 404s', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { db } = await import('../../lib/db.js');
  const { HttpError } = await import('../../lib/errors.js');

  const resolverCalls: Array<Record<string, unknown>> = [];
  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({ release: () => {} }) as never;

  const service = new ProviderImportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      resolve: async (_client: unknown, params: Record<string, unknown>) => {
        resolverCalls.push(params);
        return 272;
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    async <T>(work: (client: never) => Promise<T>) => work({} as never),
    {
      getTitle: async () => {
        throw new HttpError(404, 'missing');
      },
    } as never,
    {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  );

  try {
    const result = await (service as any).resolveImportIdentity(new Map(), {
      mediaFamily: 'movie',
      tmdbId: 328443,
      imdbId: 'tt0372784',
    });

    assert.equal(resolverCalls.length, 1);
    assert.deepEqual(resolverCalls[0], {
      source: 'imdb_id',
      externalId: 'tt0372784',
      mediaType: 'movie',
    });
    assert.equal(result.identity.mediaKey, 'movie:tmdb:272');
    assert.equal(result.identity.providerId, '272');
    assert.equal(result.tmdbId, 272);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});

test('resolveImportIdentity skips movie when direct trakt tmdb lookup 404s and imdb recovery misses', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { db } = await import('../../lib/db.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({ release: () => {} }) as never;

  const service = new ProviderImportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      resolve: async () => null,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    async <T>(work: (client: never) => Promise<T>) => work({} as never),
    {
      getTitle: async () => {
        throw new HttpError(404, 'missing');
      },
    } as never,
    {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  );

  try {
    const result = await (service as any).resolveImportIdentity(new Map(), {
      mediaFamily: 'movie',
      tmdbId: 328443,
      imdbId: 'tt0372784',
    });

    assert.equal(result, null);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});

test('resolveImportIdentity skips movie when metadata card build fails after id resolution', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { db } = await import('../../lib/db.js');

  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({ release: () => {} }) as never;

  const service = new ProviderImportService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      resolve: async () => 272,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    noopTransaction as never,
    {
      getTitle: async () => {
        throw new Error('should not use direct tmdb');
      },
    } as never,
    {
      buildCardView: async () => {
        throw new Error('metadata missing');
      },
    } as never,
  );

  try {
    const result = await (service as any).resolveImportIdentity(new Map(), {
      mediaFamily: 'movie',
      imdbId: 'tt0372784',
    });

    assert.equal(result, null);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});
