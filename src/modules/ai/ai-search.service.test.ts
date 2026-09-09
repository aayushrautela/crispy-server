import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbClient } from '../../lib/db.js';
import { seedTestEnv } from '../../test-helpers.js';
import { ShortLivedRequestCoalescer } from '../../lib/request-coalescer.js';
import type { TmdbTitleRecord } from '../metadata/providers/tmdb.types.js';
import { clientMediaCardSchema } from '../../http/contracts/shared.js';
import type { AiResolvedCandidate } from './ai.types.js';

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
      requireOwnedProfile: async () => {
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
      resolveAiCandidates: async () => ([{
        identity: { mediaType: 'movie', provider: 'tmdb', providerId: '1', contentId: '00000000-0000-0000-0000-000000000001' },
        contentId: '00000000-0000-0000-0000-000000000001',
        hydrated: { name: 'Alpha Movie', mediaType: 'movie', tmdbId: 1 },
      }]),
    } as never,
    new ShortLivedRequestCoalescer(10_000),
    async <T>(work: (client: DbClient) => Promise<T>) => work({} as DbClient),
  );

  const first = service.search('user-1', { query: 'Alpha', profileId: 'profile-1', locale: 'en-US' });
  const second = service.search('user-1', { query: 'Alpha', profileId: 'profile-1', locale: 'en-US' });

  await executorStarted;
  assert.equal(profileChecks, 1);
  assert.equal(aiCalls, 1);

  resolveAi({ items: [{ title: 'Alpha Movie', mediaType: 'movie' }] });

  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, right);
  assert.equal(profileChecks, 1);
  assert.equal(aiCalls, 1);
});

const MOVIE_CONTENT_ID = '00000000-0000-0000-0000-000000000001';
const SHOW_CONTENT_ID = '00000000-0000-0000-0000-000000000002';
const NO_ARTWORK_CONTENT_ID = '00000000-0000-0000-0000-000000000003';

function hydratedTitle(overrides: Partial<TmdbTitleRecord> = {}): TmdbTitleRecord {
  return {
    mediaType: 'movie',
    tmdbId: 1,
    language: 'en-US',
    name: 'Alpha Movie',
    originalName: 'Alpha Movie',
    overview: 'An alpha movie overview.',
    tagline: 'Be alpha.',
    releaseDate: '1982-06-25',
    firstAirDate: null,
    status: 'Released',
    posterPath: '/alpha-poster.jpg',
    backdropPath: '/alpha-backdrop.jpg',
    logoPath: null,
    runtime: 109,
    episodeRunTime: [],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: { imdb_id: 'tt0084787' },
    genreIds: [27],
    raw: {},
    fetchedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function candidate(contentId: string, hydrated: TmdbTitleRecord | null, mediaType: 'movie' | 'show' = 'movie'): AiResolvedCandidate {
  return {
    identity: {
      mediaKey: `${mediaType}:tmdb:1`,
      mediaType,
      provider: 'tmdb',
      providerId: '1',
      contentId,
      tmdbId: 1,
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
    },
    contentId,
    hydrated,
  };
}

test('buildAiSearchResponse produces schema-conformant enriched cards', async () => {
  const { buildAiSearchResponse } = await import('./ai-search.service.js');

  const internal = {
    query: 'alpha',
    locale: 'en-US',
    candidates: [
      candidate(MOVIE_CONTENT_ID, hydratedTitle()),
      candidate(SHOW_CONTENT_ID, hydratedTitle({ mediaType: 'tv', name: 'Alpha Show', releaseDate: null, firstAirDate: '2015-01-01', tmdbId: 2 }), 'show'),
    ],
  };

  const response = buildAiSearchResponse(internal);

  assert.equal(response.query, 'alpha');
  assert.equal(response.movies.length, 1);
  assert.equal(response.series.length, 1);
  assert.deepEqual(response.people, []);

  const movie = response.movies[0]!;
  assert.equal(movie.itemId, MOVIE_CONTENT_ID.replaceAll('-', ''));
  assert.equal(movie.mediaType, 'movie');
  assert.equal(movie.title, 'Alpha Movie');
  assert.equal(movie.overview, 'An alpha movie overview.');
  assert.equal(movie.year, 1982);
  assert.equal(movie.releaseDate, '1982-06-25');
  assert.equal(movie.runtimeSeconds, 109 * 60);
  assert.deepEqual(movie.genres, ['Horror']);
  assert.deepEqual(movie.providerIds, { tmdb: '1', tvdb: null, imdb: 'tt0084787' });
  assert.ok(movie.images.artwork?.medium, 'expected artwork to be populated');
  assert.equal(movie.parent, null);
  assert.equal(movie.progress, null);

  const series = response.series[0]!;
  assert.equal(series.mediaType, 'tv');
  assert.equal(series.title, 'Alpha Show');
  assert.equal(series.year, 2015);

  for (const card of [movie, series]) {
    const result = clientMediaCardSchema as unknown as { required: string[]; additionalProperties: boolean };
    for (const key of result.required) {
      assert.ok(key in card, `card missing required key: ${key}`);
    }
    assert.equal('parentId' in card, false, 'card must not carry the retired parentId field');
  }
});

test('buildAiSearchResponse drops candidates without hydration or artwork and dedupes by contentId', async () => {
  const { buildAiSearchResponse } = await import('./ai-search.service.js');

  const internal = {
    query: 'alpha',
    locale: 'en-US',
    candidates: [
      candidate(MOVIE_CONTENT_ID, null),
      candidate(NO_ARTWORK_CONTENT_ID, hydratedTitle({ posterPath: null, backdropPath: null })),
      candidate(MOVIE_CONTENT_ID, hydratedTitle()),
      candidate(MOVIE_CONTENT_ID, hydratedTitle({ tmdbId: 9, name: 'Duplicate' })),
    ],
  };

  const response = buildAiSearchResponse(internal);

  assert.equal(response.movies.length, 1);
  assert.equal(response.series.length, 0);
  assert.equal(response.movies[0]!.title, 'Alpha Movie');
  assert.equal(response.movies[0]!.itemId, MOVIE_CONTENT_ID.replaceAll('-', ''));
});
