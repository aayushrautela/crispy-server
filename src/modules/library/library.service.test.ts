import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
  process.env.TRAKT_IMPORT_CLIENT_ID ??= 'trakt-client-id';
  process.env.SIMKL_IMPORT_CLIENT_ID ??= 'simkl-client-id';
}

seedTestEnv();

test('library service hydrates provider items and mutates providers', async (t) => {
  const { LibraryService } = await import('./library.service.js');

  const metadataDirectService = {
    resolveMetadataView: async (input: Record<string, unknown>) => ({
      id: typeof input.imdbId === 'string' ? input.imdbId : `crisp:${String(input.mediaType)}:${String(input.tmdbId ?? input.id ?? 'x')}`,
      mediaKey: 'movie:tmdb:1',
      mediaType: input.mediaType === 'episode' ? 'episode' : (input.mediaType ?? 'movie'),
      kind: input.mediaType === 'episode' ? 'episode' : 'title',
      tmdbId: typeof input.tmdbId === 'number' ? input.tmdbId : 1,
      showTmdbId: input.mediaType === 'episode' ? (typeof input.tmdbId === 'number' ? input.tmdbId : 2) : null,
      seasonNumber: typeof input.seasonNumber === 'number' ? input.seasonNumber : null,
      episodeNumber: typeof input.episodeNumber === 'number' ? input.episodeNumber : null,
      title: typeof input.imdbId === 'string' ? `Hydrated ${input.imdbId}` : 'Hydrated',
      subtitle: null,
      summary: null,
      overview: null,
      artwork: { posterUrl: 'https://img/poster.jpg', backdropUrl: 'https://img/backdrop.jpg', stillUrl: null },
      images: { posterUrl: 'https://img/poster.jpg', backdropUrl: 'https://img/backdrop.jpg', stillUrl: null, logoUrl: null },
      releaseDate: null,
      releaseYear: 2024,
      runtimeMinutes: null,
      rating: null,
      certification: null,
      status: null,
      genres: [],
      externalIds: { tmdb: typeof input.tmdbId === 'number' ? input.tmdbId : 1, imdb: typeof input.imdbId === 'string' ? input.imdbId : 'tt7654321', tvdb: null },
      seasonCount: null,
      episodeCount: null,
      nextEpisode: null,
    }),
    resolvePlayback: async (input: Record<string, unknown>) => ({
      item: {
        id: 'crisp:movie:12',
        mediaKey: 'movie:tmdb:12',
        mediaType: 'movie',
        kind: 'title',
        tmdbId: 12,
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
        title: 'Resolved Movie',
        subtitle: null,
        summary: null,
        overview: null,
        artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
        images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
        releaseDate: null,
        releaseYear: 2024,
        runtimeMinutes: null,
        rating: null,
        certification: null,
        status: null,
        genres: [],
        externalIds: { tmdb: 12, imdb: typeof input.imdbId === 'string' ? input.imdbId : 'tt1234567', tvdb: null },
        seasonCount: null,
        episodeCount: null,
        nextEpisode: null,
      },
      show: null,
      season: null,
    }),
  };

  const tokenService = {
    getAccessTokenForAccountProfile: async (_accountId: string, _profileId: string, provider: string) => ({
      connectionId: `${provider}-connection`,
      profileId: 'profile-1',
      provider,
      accessToken: `${provider}-token`,
      accessTokenExpiresAt: null,
      refreshed: false,
    }),
    getTokenStatusForAccountProfile: async () => ({ tokenState: 'valid' }),
  };

  const service = new LibraryService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { getForProfile: async () => null } as never,
    { listForProfile: async () => [] } as never,
    tokenService as never,
    { list: async () => [] } as never,
    { list: async () => [] } as never,
    { listWatchlist: async () => [], listRatings: async () => [] } as never,
    metadataDirectService as never,
  );
  service.requireOwnedProfile = async () => {};
  service.getProviderAuthState = async () => [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.includes('api.trakt.tv/sync/watchlist/movies')) {
      return new Response(JSON.stringify([{ listed_at: '2024-01-01T00:00:00.000Z', movie: { title: 'Movie', ids: { imdb: 'tt1111111', tmdb: 11 }, images: {} } }]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.trakt.tv/sync/watchlist/shows')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.trakt.tv/sync/watched/movies')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.trakt.tv/sync/watched/shows')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.trakt.tv/sync/collection/movies')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.trakt.tv/sync/collection/shows')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.trakt.tv/sync/ratings/movies')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.trakt.tv/sync/ratings/shows')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.trakt.tv/sync/playback')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }

    if (method === 'GET' && url.includes('api.simkl.com/sync/playback/movies')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.simkl.com/sync/playback/episodes')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.simkl.com/sync/ratings/movies')) {
      return new Response(JSON.stringify({ movies: [] }), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.simkl.com/sync/ratings/shows')) {
      return new Response(JSON.stringify({ shows: [] }), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.simkl.com/sync/ratings/anime')) {
      return new Response(JSON.stringify({ anime: [] }), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.simkl.com/sync/all-items/movies/plantowatch')) {
      return new Response(JSON.stringify({ movies: [{ added_to_watchlist_at: '2024-01-02T00:00:00.000Z', movie: { title: 'Simkl Movie', ids: { imdb: 'tt2222222', tmdb: 22 }, poster: 'poster.jpg', fanart: 'fanart.jpg' } }] }), { status: 200 });
    }
    if (method === 'GET' && url.includes('api.simkl.com/sync/all-items/')) {
      if (url.includes('/shows/') || url.includes('/anime/')) {
        const key = url.includes('/shows/') ? 'shows' : 'anime';
        return new Response(JSON.stringify({ [key]: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ movies: [] }), { status: 200 });
    }

    if (method === 'POST' && (url.includes('api.trakt.tv/sync/watchlist') || url.includes('api.trakt.tv/sync/ratings') || url.includes('api.simkl.com/sync/add-to-list') || url.includes('api.simkl.com/sync/ratings'))) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const library = await service.getProfileLibrary('user-1', 'profile-1', { source: 'all', limitPerFolder: 10 });
  const trakt = library.providers.find((provider) => provider.provider === 'trakt');
  const simkl = library.providers.find((provider) => provider.provider === 'simkl');
  assert.ok(trakt);
  assert.ok(simkl);
  assert.equal(trakt?.items[0]?.media?.title, 'Hydrated tt1111111');
  assert.equal(simkl?.items[0]?.media?.title, 'Hydrated tt2222222');

  const watchlistResult = await service.setWatchlist('user-1', 'profile-1', {
    source: 'all',
    inWatchlist: true,
    imdbId: 'tt1234567',
    mediaType: 'movie',
  });
  assert.equal(watchlistResult.statusMessage, 'Saved to watchlist.');
  assert.equal(watchlistResult.results.length, 2);
  assert.equal(watchlistResult.results.every((result) => result.status === 'success'), true);

  const ratingResult = await service.setRating('user-1', 'profile-1', {
    source: 'all',
    rating: 8,
    imdbId: 'tt1234567',
    mediaType: 'movie',
  });
  assert.equal(ratingResult.statusMessage, 'Rated 8/10.');
  assert.equal(ratingResult.results.length, 2);
});

test('library service reports simkl rating removal as skipped', async () => {
  const { LibraryService } = await import('./library.service.js');
  const service = new LibraryService(
    { findByIdForOwnerUser: async () => ({ id: 'profile-1' }) } as never,
    { getForProfile: async () => null } as never,
    { listForProfile: async () => [] } as never,
    {
      getAccessTokenForAccountProfile: async () => ({ accessToken: 'simkl-token' }),
      getTokenStatusForAccountProfile: async () => ({ tokenState: 'valid' }),
    } as never,
    { list: async () => [] } as never,
    { list: async () => [] } as never,
    { listWatchlist: async () => [], listRatings: async () => [] } as never,
    {
      resolvePlayback: async () => ({
        item: {
          id: 'crisp:movie:12',
          mediaKey: 'movie:tmdb:12',
          mediaType: 'movie',
          kind: 'title',
          tmdbId: 12,
          showTmdbId: null,
          seasonNumber: null,
          episodeNumber: null,
          title: 'Resolved Movie',
          subtitle: null,
          summary: null,
          overview: null,
          artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
          images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
          releaseDate: null,
          releaseYear: 2024,
          runtimeMinutes: null,
          rating: null,
          certification: null,
          status: null,
          genres: [],
          externalIds: { tmdb: 12, imdb: 'tt1234567', tvdb: null },
          seasonCount: null,
          episodeCount: null,
          nextEpisode: null,
        },
        show: null,
        season: null,
      }),
    } as never,
  );
  service.requireOwnedProfile = async () => {};

  const result = await service.setRating('user-1', 'profile-1', {
    source: 'simkl',
    rating: null,
    imdbId: 'tt1234567',
    mediaType: 'movie',
  });

  assert.equal(result.statusMessage, 'Removing ratings is not supported for Simkl.');
  assert.equal(result.results[0]?.status, 'skipped');
});
