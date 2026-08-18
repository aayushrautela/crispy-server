import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-client-id', TRAKT_IMPORT_CLIENT_SECRET: 'trakt-client-secret', TRAKT_IMPORT_REDIRECT_URI: 'https://api.crispytv.tech/v1/imports/trakt/callback' });

const noopTransaction = async <T>(work: (client: never) => Promise<T>): Promise<T> => work({} as never);

test('TraktImportService buildAuthUrl uses trakt.tv authorize host', async () => {
  const { TraktImportService } = await import('./trakt/trakt-import.service.js');
  const service = new TraktImportService();
  const authUrl = service.buildAuthUrl('state-123', 'challenge-abc');

  assert.ok(authUrl);
  const url = new URL(authUrl);
  assert.equal(url.origin, 'https://trakt.tv');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'trakt-client-id');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('TraktImportService exchangeAuthorizationCode includes details for non-json failures', async () => {
  const { TraktImportService } = await import('./trakt/trakt-import.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } })) as typeof fetch;

  try {
    const service = new TraktImportService();
    await assert.rejects(
      () => service.exchangeAuthorizationCode('code-123', 'verifier-123'),
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

test('TraktImportClient getArray includes upstream response details for import failures', async () => {
  const { TraktImportClient } = await import('./trakt/trakt-import.client.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: 'invalid_grant' }, { status: 401 })) as typeof fetch;

  try {
    const client = new TraktImportClient();
    await assert.rejects(
      () => client.getArray('/sync/history', 'access-123'),
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

test('ProviderImportService.revokeAuthorization revokes trakt upstream before local disconnect', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');

  const profileRepository = {
    requireOwnedProfile: async () => ({ id: 'profile-1' }),
  };
  const providerSessionsRepository = {
    findByProfileAndProvider: async () => ({
      id: 'acct-1',
      profileId: 'profile-1',
      provider: 'trakt',
      state: 'connected',
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
    }),
    markDisconnected: async () => ({
      id: 'acct-1',
      profileId: 'profile-1',
      provider: 'trakt',
      state: 'disconnected_by_user',
      stateToken: null,
      providerUserId: null,
      externalUsername: null,
      credentialsJson: {},
      createdByUserId: 'account-1',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: '2026-03-24T00:00:00.000Z',
      connectedAt: '2026-03-24T00:05:00.000Z',
      updatedAt: '2026-03-26T00:00:00.000Z',
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
      providerSessionsRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      noopTransaction as never,
      {} as never,
      {} as never,
      {} as never,
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

test('TraktImportService.fetchAndNormalizeImport keeps show tmdb ids on watchlist and ratings', async () => {
  const { TraktImportService } = await import('./trakt/trakt-import.service.js');
  const { inferMediaIdentity } = await import('../identity/media-key.js');

  const service = new TraktImportService({
    externalIdResolver: {
      resolve: async () => 9001,
    } as never,
    tmdbCacheService: {} as never,
    metadataCardService: {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  });
  (service as any).traktResolver.resolve = async (_cache: unknown, params: { tvdbId?: string | null }) => {
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
    if (url.includes('/sync/watched/shows')) {
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
    if (url.endsWith('/sync/history/movies')) {
      return Response.json([]);
    }
    if (url.endsWith('/sync/history/shows')) {
      return Response.json([]);
    }
    return Response.json([]);
  }) as typeof fetch;

  try {
    const result = await service.fetchAndNormalizeImport(
      { id: 'job-1' } as never,
      { accessToken: 'token-123' },
    );

    const watchlistEvent = result.importedEvents.find((entry: any) => entry.eventType === 'watchlist_put');
    const ratingEvent = result.importedEvents.find((entry: any) => entry.eventType === 'rating_put');

    assert.ok(watchlistEvent);
    assert.ok(ratingEvent);
    assert.equal(watchlistEvent.showTmdbId, 9001);
    assert.equal(ratingEvent.showTmdbId, 9001);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TraktImportService.fetchAndNormalizeImport carries show tmdb ids into episode playback events', async () => {
  const { TraktImportService } = await import('./trakt/trakt-import.service.js');
  const { inferMediaIdentity } = await import('../identity/media-key.js');

  const service = new TraktImportService({
    externalIdResolver: {
      resolve: async () => 777,
    } as never,
    tmdbCacheService: {} as never,
    metadataCardService: {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  });
  (service as any).traktResolver.resolve = async (_cache: unknown, params: { tvdbId?: string | null }) => {
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
    const result = await service.fetchAndNormalizeImport(
      { id: 'job-1' } as never,
      { accessToken: 'token-123' },
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
      progressBps: 2500,
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

test('TraktImportService.fetchAndNormalizeImport keeps Trakt playback progress without runtime', async () => {
  const { TraktImportService } = await import('./trakt/trakt-import.service.js');
  const { inferMediaIdentity } = await import('../identity/media-key.js');

  const service = new TraktImportService({
    externalIdResolver: {
      resolve: async () => 272,
    } as never,
    tmdbCacheService: {} as never,
    metadataCardService: {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  });
  (service as any).traktResolver.resolve = async (_cache: unknown, params: { tmdbId?: number | null }) => {
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
    const result = await service.fetchAndNormalizeImport(
      { id: 'job-1' } as never,
      { accessToken: 'token-123' },
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
      progressBps: 1000,
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

test('TraktImportService.fetchAndNormalizeImport emits per-episode history for watched shows', async () => {
  const { TraktImportService } = await import('./trakt/trakt-import.service.js');
  const { inferMediaIdentity } = await import('../identity/media-key.js');

  const service = new TraktImportService({
    externalIdResolver: {
      resolve: async () => 9001,
    } as never,
    tmdbCacheService: {} as never,
    metadataCardService: {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  });
  (service as any).traktResolver.resolve = async (_cache: unknown, params: { tmdbId?: number | null }) => {
    if (params.tmdbId !== 9001) {
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
      tvdbId: null,
      kitsuId: null,
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/sync/watched/movies')) {
      return Response.json([]);
    }
    if (url.includes('/sync/watched/shows')) {
      return Response.json([{
        plays: 3,
        last_watched_at: '2024-01-15T00:00:00.000Z',
        last_updated_at: '2024-01-15T00:00:00.000Z',
        reset_at: null,
        show: { ids: { tmdb: 9001, imdb: 'tt0944947' } },
        seasons: [
          {
            number: 1,
            episodes: [
              { number: 1, plays: 1, last_watched_at: '2023-12-01T00:00:00.000Z' },
              { number: 2, plays: 1, last_watched_at: '2023-12-08T00:00:00.000Z' },
            ],
          },
          {
            number: 2,
            episodes: [
              { number: 1, plays: 1, last_watched_at: '2024-01-15T00:00:00.000Z' },
            ],
          },
        ],
      }]);
    }
    if (url.includes('/sync/watchlist/movies')) {
      return Response.json([]);
    }
    if (url.includes('/sync/watchlist/shows')) {
      return Response.json([]);
    }
    if (url.includes('/sync/ratings/movies')) {
      return Response.json([]);
    }
    if (url.includes('/sync/ratings/shows')) {
      return Response.json([]);
    }
    if (url.includes('/sync/playback')) {
      return Response.json([]);
    }
    if (url.includes('/sync/history/movies')) {
      return Response.json([]);
    }
    if (url.includes('/sync/history/shows')) {
      return Response.json([]);
    }
    return Response.json([]);
  }) as typeof fetch;

  try {
    const result = await service.fetchAndNormalizeImport(
      { id: 'job-1' } as never,
      { accessToken: 'token-123' },
    );

    const markWatchedEvents = result.importedEvents.filter((e: any) => e.eventType === 'mark_watched');
    assert.equal(markWatchedEvents.length, 3);

    assert.deepEqual(
      markWatchedEvents.map((e: any) => ({ mediaKey: e.mediaKey, showTmdbId: e.showTmdbId, seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, occurredAt: e.occurredAt })),
      [
        { mediaKey: 'episode:tmdb:9001:1:1', showTmdbId: 9001, seasonNumber: 1, episodeNumber: 1, occurredAt: '2023-12-01T00:00:00.000Z' },
        { mediaKey: 'episode:tmdb:9001:1:2', showTmdbId: 9001, seasonNumber: 1, episodeNumber: 2, occurredAt: '2023-12-08T00:00:00.000Z' },
        { mediaKey: 'episode:tmdb:9001:2:1', showTmdbId: 9001, seasonNumber: 2, episodeNumber: 1, occurredAt: '2024-01-15T00:00:00.000Z' },
      ],
    );

    const historyEntries = result.importedHistoryEntries;
    assert.equal(historyEntries.length, 3);
    assert.ok(historyEntries[0]);
    assert.equal(historyEntries[0].mediaType, 'episode');
    assert.equal(historyEntries[0].mediaKey, 'episode:tmdb:9001:1:1');
    assert.equal(historyEntries[0].watchedAt, '2023-12-01T00:00:00.000Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TraktImportIdentityResolver keeps direct trakt tmdb id for movies when tmdb lookup succeeds', async () => {
  const { TraktImportIdentityResolver } = await import('./trakt/trakt-import.resolver.js');
  const { db } = await import('../../lib/db.js');

  const resolverCalls: Array<Record<string, unknown>> = [];
  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({ release: () => {} }) as never;

  const resolver = new TraktImportIdentityResolver({
    externalIdResolver: {
      resolve: async (_client: unknown, params: Record<string, unknown>) => {
        resolverCalls.push(params);
        return 272;
      },
    } as never,
    tmdbCacheService: {
      getTitle: async () => ({ tmdbId: 328443 }),
    } as never,
    metadataCardService: {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  });

  try {
    const result = await resolver.resolve(new Map(), {
      mediaFamily: 'movie',
      tmdbId: 328443,
      imdbId: 'tt0372784',
    });

    assert.equal(resolverCalls.length, 0);
    assert.equal(result!.identity.mediaKey, 'movie:tmdb:328443');
    assert.equal(result!.identity.providerId, '328443');
    assert.equal(result!.tmdbId, 328443);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});

test('TraktImportIdentityResolver falls back to imdb canonicalization when direct trakt tmdb lookup 404s', async () => {
  const { TraktImportIdentityResolver } = await import('./trakt/trakt-import.resolver.js');
  const { db } = await import('../../lib/db.js');
  const { HttpError } = await import('../../lib/errors.js');

  const resolverCalls: Array<Record<string, unknown>> = [];
  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({ release: () => {} }) as never;

  const resolver = new TraktImportIdentityResolver({
    externalIdResolver: {
      resolve: async (_client: unknown, params: Record<string, unknown>) => {
        resolverCalls.push(params);
        return 272;
      },
    } as never,
    tmdbCacheService: {
      getTitle: async () => {
        throw new HttpError(404, 'missing');
      },
    } as never,
    metadataCardService: {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  });

  try {
    const result = await resolver.resolve(new Map(), {
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
    assert.equal(result!.identity.mediaKey, 'movie:tmdb:272');
    assert.equal(result!.identity.providerId, '272');
    assert.equal(result!.tmdbId, 272);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});

test('TraktImportIdentityResolver skips movie when direct trakt tmdb lookup 404s and imdb recovery misses', async () => {
  const { TraktImportIdentityResolver } = await import('./trakt/trakt-import.resolver.js');
  const { db } = await import('../../lib/db.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({ release: () => {} }) as never;

  const resolver = new TraktImportIdentityResolver({
    externalIdResolver: {
      resolve: async () => null,
    } as never,
    tmdbCacheService: {
      getTitle: async () => {
        throw new HttpError(404, 'missing');
      },
    } as never,
    metadataCardService: {
      buildCardView: async () => ({ title: 'ok' }),
    } as never,
  });

  try {
    const result = await resolver.resolve(new Map(), {
      mediaFamily: 'movie',
      tmdbId: 328443,
      imdbId: 'tt0372784',
    });

    assert.equal(result, null);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});

test('TraktImportIdentityResolver skips movie when metadata card build fails after id resolution', async () => {
  const { TraktImportIdentityResolver } = await import('./trakt/trakt-import.resolver.js');
  const { db } = await import('../../lib/db.js');

  const originalConnect = db.connect;
  (db as { connect: typeof db.connect }).connect = async () => ({ release: () => {} }) as never;

  const resolver = new TraktImportIdentityResolver({
    externalIdResolver: {
      resolve: async () => 272,
    } as never,
    tmdbCacheService: {
      getTitle: async () => {
        throw new Error('should not use direct tmdb');
      },
    } as never,
    metadataCardService: {
      buildCardView: async () => {
        throw new Error('metadata missing');
      },
    } as never,
  });

  try {
    const result = await resolver.resolve(new Map(), {
      mediaFamily: 'movie',
      imdbId: 'tt0372784',
    });

    assert.equal(result, null);
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});
