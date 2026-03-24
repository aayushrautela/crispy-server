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

async function loadModule() {
  seedTestEnv();
  return import('./next-episode.js');
}

test('findNextEpisode skips watched and unreleased episodes', async () => {
  const { findNextEpisode } = await loadModule();

  const next = findNextEpisode({
    currentSeasonNumber: 1,
    currentEpisodeNumber: 1,
    showId: '12345',
    nowMs: Date.parse('2024-01-15T12:00:00.000Z'),
    watchedKeys: ['tt12345:1:2'],
    episodes: [
      { seasonNumber: 1, episodeNumber: 2, title: 'Watched', releaseDate: '2024-01-05' },
      { seasonNumber: 1, episodeNumber: 3, title: 'Future', releaseDate: '2024-02-01' },
      { seasonNumber: 1, episodeNumber: 4, title: 'Playable', releaseDate: '2024-01-10' },
    ],
  });

  assert.deepEqual(next, {
    seasonNumber: 1,
    episodeNumber: 4,
    title: 'Playable',
    releaseDate: '2024-01-10',
  });
});

test('findNextEpisode accepts date-only releases on the same day', async () => {
  const { findNextEpisode } = await loadModule();

  const next = findNextEpisode({
    currentSeasonNumber: 2,
    currentEpisodeNumber: 4,
    nowMs: Date.parse('2024-03-01T08:00:00.000Z'),
    episodes: [
      { seasonNumber: 2, episodeNumber: 5, title: 'Today', releaseDate: '2024-03-01' },
      { seasonNumber: 2, episodeNumber: 6, title: 'Later', releaseDate: '2024-03-10' },
    ],
  });

  assert.deepEqual(next, {
    seasonNumber: 2,
    episodeNumber: 5,
    title: 'Today',
    releaseDate: '2024-03-01',
  });
});

test('findNextEpisode returns null when show id is missing and watched set blocks nothing releasable', async () => {
  const { findNextEpisode } = await loadModule();

  const next = findNextEpisode({
    currentSeasonNumber: 1,
    currentEpisodeNumber: 9,
    watchedKeys: ['tt999:1:10'],
    nowMs: Date.parse('2024-01-01T00:00:00.000Z'),
    episodes: [
      { seasonNumber: 1, episodeNumber: 10, title: 'Blocked by missing show id', releaseDate: '2024-01-01' },
      { seasonNumber: 1, episodeNumber: 11, title: 'Unreleased', releaseDate: '2024-02-01' },
    ],
  });

  assert.equal(next?.episodeNumber, 10);
});
