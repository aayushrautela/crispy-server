import test from 'node:test';
import assert from 'node:assert/strict';

import type { TmdbTitleRecord, TmdbTitleType } from './tmdb.types.js';

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

async function loadTmdbRefreshService(): Promise<typeof import('./tmdb-refresh.service.js').TmdbRefreshService> {
  seedTestEnv();
  const module = await import('./tmdb-refresh.service.js');
  return module.TmdbRefreshService;
}

function makeTitle(overrides: Partial<TmdbTitleRecord> = {}): TmdbTitleRecord {
  return {
    mediaType: 'tv' satisfies TmdbTitleType,
    tmdbId: 42,
    name: 'Show',
    originalName: 'Show',
    overview: null,
    releaseDate: null,
    firstAirDate: '2024-01-01',
    status: 'Returning Series',
    posterPath: null,
    backdropPath: null,
    runtime: null,
    episodeRunTime: [],
    numberOfSeasons: 4,
    numberOfEpisodes: 40,
    externalIds: {},
    raw: {},
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
    ...overrides,
  };
}

test('refreshMediaKey refreshes explicit episode season plus next/last seasons without duplicates', async () => {
  const TmdbRefreshService = await loadTmdbRefreshService();
  const refreshedSeasons: number[] = [];
  const updatedTrackedShows: Array<{
    profileId: string;
    showTmdbId: number;
    nextEpisodeAirDate: string | null;
    metadataRefreshedAt?: string;
  }> = [];

  const tmdbCacheService = {
    refreshTitle: async () => makeTitle({
      raw: {
        next_episode_to_air: { season_number: 3, episode_number: 2, air_date: '2026-03-25' },
        last_episode_to_air: { season_number: 2, episode_number: 8, air_date: '2026-03-18' },
      },
    }),
    refreshSeason: async (_client: unknown, _showTmdbId: number, seasonNumber: number) => {
      refreshedSeasons.push(seasonNumber);
    },
  };

  const trackedSeriesRepository = {
    listForProfile: async () => [],
    updateMetadataState: async (_client: unknown, params: { profileId: string; showTmdbId: number; nextEpisodeAirDate: string | null }) => {
      updatedTrackedShows.push(params);
    },
  };

  const service = new TmdbRefreshService(
    tmdbCacheService as never,
    trackedSeriesRepository as never,
  );

  const summary = await service.refreshMediaKey({} as never, 'profile-1', 'episode:tmdb:42:2:4');

  assert.deepEqual(refreshedSeasons, [2, 3]);
  assert.equal(summary.refreshedTitles, 1);
  assert.equal(summary.refreshedSeasons, 2);
  assert.equal(summary.refreshedTrackedShows, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.failures, 0);
  assert.deepEqual(updatedTrackedShows, [
    {
      profileId: 'profile-1',
      showTmdbId: 42,
      nextEpisodeAirDate: '2026-03-25',
      metadataRefreshedAt: updatedTrackedShows[0]?.metadataRefreshedAt,
    },
  ]);
});

test('refreshIdentity for movie refreshes title only', async () => {
  const TmdbRefreshService = await loadTmdbRefreshService();
  let refreshedMovie = 0;
  let refreshedSeason = 0;

  const tmdbCacheService = {
    refreshTitle: async (_client: unknown, mediaType: string, tmdbId: number) => {
      assert.equal(mediaType, 'movie');
      assert.equal(tmdbId, 9);
      refreshedMovie += 1;
      return makeTitle({ mediaType: 'movie', tmdbId: 9, numberOfSeasons: null, numberOfEpisodes: null });
    },
    refreshSeason: async () => {
      refreshedSeason += 1;
    },
  };

  const trackedSeriesRepository = {
    listForProfile: async () => [],
    updateMetadataState: async () => {
      throw new Error('movie refresh should not touch tracked series state');
    },
  };

  const service = new TmdbRefreshService(
    tmdbCacheService as never,
    trackedSeriesRepository as never,
  );

  const summary = await service.refreshIdentity({} as never, 'profile-1', {
    mediaKey: 'movie:tmdb:9',
    mediaType: 'movie',
    tmdbId: 9,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
  });

  assert.equal(refreshedMovie, 1);
  assert.equal(refreshedSeason, 0);
  assert.equal(summary.refreshedTitles, 1);
  assert.equal(summary.refreshedSeasons, 0);
  assert.equal(summary.refreshedTrackedShows, 0);
});
