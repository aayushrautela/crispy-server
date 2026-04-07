import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbClient } from '../../lib/db.js';
import { seedTestEnv } from '../../test-helpers.js';
import { ShortLivedRequestCoalescer } from '../../lib/request-coalescer.js';

seedTestEnv();

test('ShortLivedRequestCoalescer reuses inflight and cached results', async () => {
  let now = 1_000;
  const coalescer = new ShortLivedRequestCoalescer<string>(50, () => now);
  let calls = 0;
  let resolveWork!: (value: string) => void;
  const workPromise = new Promise<string>((resolve) => {
    resolveWork = resolve;
  });

  const work = async () => {
    calls += 1;
    return workPromise;
  };

  const first = coalescer.run('alpha', work);
  const second = coalescer.run('alpha', work);
  assert.equal(calls, 1);

  resolveWork('done');
  assert.equal(await first, 'done');
  assert.equal(await second, 'done');

  const cached = await coalescer.run('alpha', work);
  assert.equal(cached, 'done');
  assert.equal(calls, 1);

  now += 60;
  let refreshCalls = 0;
  const refreshed = await coalescer.run('alpha', async () => {
    refreshCalls += 1;
    return 'fresh';
  });
  assert.equal(refreshed, 'fresh');
  assert.equal(refreshCalls, 1);
});

test('buildResolutionQueryVariants keeps only distinct normalized query variants', async () => {
  const { buildResolutionQueryVariants } = await import('./ai-search.service.js');

  assert.deepEqual(buildResolutionQueryVariants('Spider-Man: Into the Spider-Verse (2018)'), [
    'Spider-Man: Into the Spider-Verse (2018)',
    'Spider-Man',
    'Spider-Man: Into the Spider-Verse',
  ]);
});

test('isSameTitleFamily keeps distinct titles that only share a leading token', async () => {
  const { isSameTitleFamily } = await import('./ai-search.service.js');

  assert.equal(isSameTitleFamily('Fantastic Beasts and Where to Find Them', 'Fantastic Mr. Fox'), false);
  assert.equal(isSameTitleFamily('The Lord of the Rings: The Fellowship of the Ring', 'The Lord of the Rings: The Two Towers'), true);
});

test('AiSearchService coalesces identical in-flight searches', async () => {
  const pkg = await import('./ai-search.service.js');
  let profileChecks = 0;
  let aiCalls = 0;
  let markExecutorStarted!: () => void;
  const executorStarted = new Promise<void>((resolve) => {
    markExecutorStarted = resolve;
  });
  let resolveAi!: (value: { items: Array<{ title: string; mediaType: 'movie' }> }) => void;
  const aiPromise = new Promise<{ items: Array<{ title: string; mediaType: 'movie' }> }>((resolve) => {
    resolveAi = resolve;
  });

  const service = new pkg.AiSearchService(
    {
      findByIdForOwnerUser: async () => {
        profileChecks += 1;
        return { id: 'profile-1' };
      },
    } as never,
    {
      generateJsonForUser: async () => {
        aiCalls += 1;
        markExecutorStarted();
        const payload = await aiPromise;
        return {
          payload,
          request: { providerId: 'openai', model: 'gpt-4o-mini' },
        };
      },
    } as never,
    {
      searchTitles: async () => ({
        query: 'Alpha',
        all: [{ mediaType: 'movie', mediaKey: 'movie:tmdb:1', provider: 'tmdb', providerId: '1', title: 'Alpha Movie', posterUrl: 'https://img.example/alpha.jpg', releaseYear: 2024, rating: 8.1, genre: null, subtitle: null }],
        movies: [{ mediaType: 'movie', mediaKey: 'movie:tmdb:1', provider: 'tmdb', providerId: '1', title: 'Alpha Movie', posterUrl: 'https://img.example/alpha.jpg', releaseYear: 2024, rating: 8.1, genre: null, subtitle: null }],
        series: [],
        anime: [],
      }),
    } as never,
    new ShortLivedRequestCoalescer(10_000),
    async <T>(work: (client: DbClient) => Promise<T>) => work({} as DbClient),
  );

  const first = service.search('user-1', { query: 'Alpha', profileId: 'profile-1', filter: 'all', locale: 'en-US' });
  const second = service.search('user-1', { query: 'Alpha', profileId: 'profile-1', filter: 'all', locale: 'en-US' });

  await executorStarted;
  assert.equal(profileChecks, 1);
  assert.equal(aiCalls, 1);

  resolveAi({ items: [{ title: 'Alpha Movie', mediaType: 'movie' }] });

  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.equal(profileChecks, 1);
  assert.equal(aiCalls, 1);
  assert.deepEqual(left.items.map((item) => item.title), ['Alpha Movie']);
});
