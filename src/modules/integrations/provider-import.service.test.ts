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

    const result = await service.disconnectConnection('account-1', 'profile-1', 'trakt');
    assert.equal(result.providerAccount.status, 'revoked');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'https://api.trakt.tv/oauth/revoke');
    assert.match(fetchCalls[0]?.body ?? '', /"token":"refresh-123"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('disconnectConnection surfaces trakt revoke failures', async () => {
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
      () => service.disconnectConnection('account-1', 'profile-1', 'trakt'),
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
      provider: 'tvdb',
      providerId: '121361',
      tvdbId: 121361,
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
      provider: 'tvdb',
      providerId: '121361',
      tvdbId: 121361,
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
      mediaKey: 'episode:tvdb:121361:2:3',
      mediaType: 'episode',
      provider: 'tvdb',
      providerId: '121361:s2:e3',
      parentProvider: 'tvdb',
      parentProviderId: '121361',
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
