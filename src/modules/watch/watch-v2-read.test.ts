import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { WatchQueryService } = await import('./watch-query.service.js');
const { WatchStateService } = await import('./watch-state.service.js');
const { WatchEventIngestService } = await import('./event-ingest.service.js');
const { parseMediaKey } = await import('../identity/media-key.js');
const { db } = await import('../../lib/db.js');

test('listContinueWatchingPage emits synthetic cw2 ids from title projection rows', { concurrency: false }, async () => {
  const service = new WatchQueryService();
  const client = {
    query: async () => ({
      rows: [
        {
          title_content_id: '11111111-1111-4111-8111-111111111111',
          title_media_key: 'show:tmdb:100',
          title_media_type: 'show',
          title_text: 'Example Show',
          title_subtitle: null,
          title_poster_url: 'https://img.test/poster.jpg',
          title_backdrop_url: 'https://img.test/backdrop.jpg',
          title_release_year: 2024,
          title_runtime_minutes: 45,
          title_rating: 8.2,
          active_media_key: 'episode:tmdb:100:1:2',
          active_media_type: 'episode',
          active_provider: 'tmdb',
          active_provider_id: '100:s1:e2',
          active_parent_provider: 'tmdb',
          active_parent_provider_id: '100',
          active_season_number: 1,
          active_episode_number: 2,
          active_episode_title: 'Episode 2',
          active_episode_release_at: '2024-01-02T00:00:00.000Z',
          active_position_seconds: 120,
          active_duration_seconds: 2400,
          active_progress_percent: 5,
          last_activity_at: '2024-01-03T00:00:00.000Z',
        },
      ],
    }),
  } as never;

  const page = await service.listContinueWatchingPage(client, 'profile-1', { limit: 20 });

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.id, 'cw2:11111111-1111-4111-8111-111111111111');
  assert.equal(page.items[0]?.mediaKey, 'episode:tmdb:100:1:2');
  assert.equal(page.items[0]?.title, 'Example Show');
  assert.equal(page.pageInfo.hasMore, false);
  assert.equal(page.pageInfo.nextCursor, null);
});

test('listContinueWatchingPage filters invalid projection rows before filling the page window', { concurrency: false }, async () => {
  const service = new WatchQueryService();
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return {
        rows: [
          {
            title_content_id: '22222222-2222-4222-8222-222222222222',
            title_media_key: 'movie:tmdb:200',
            title_media_type: 'movie',
            title_text: 'Valid Movie',
            title_subtitle: null,
            title_poster_url: 'https://img.test/movie-poster.jpg',
            title_backdrop_url: 'https://img.test/movie-backdrop.jpg',
            title_release_year: 2024,
            title_runtime_minutes: 120,
            title_rating: 7.5,
            active_media_key: 'movie:tmdb:200',
            active_media_type: 'movie',
            active_provider: 'tmdb',
            active_provider_id: '200',
            active_parent_provider: null,
            active_parent_provider_id: null,
            active_season_number: null,
            active_episode_number: null,
            active_episode_title: null,
            active_episode_release_at: null,
            active_position_seconds: 300,
            active_duration_seconds: 7200,
            active_progress_percent: 4,
            last_activity_at: '2024-01-03T00:00:00.000Z',
          },
          {
            title_content_id: '11111111-1111-4111-8111-111111111111',
            title_media_key: 'show:tmdb:100',
            title_media_type: 'show',
            title_text: 'Example Show',
            title_subtitle: null,
            title_poster_url: 'https://img.test/poster.jpg',
            title_backdrop_url: 'https://img.test/backdrop.jpg',
            title_release_year: 2024,
            title_runtime_minutes: 45,
            title_rating: 8.2,
            active_media_key: 'episode:tmdb:100:1:2',
            active_media_type: 'episode',
            active_provider: 'tmdb',
            active_provider_id: '100:s1:e2',
            active_parent_provider: 'tmdb',
            active_parent_provider_id: '100',
            active_season_number: 1,
            active_episode_number: 2,
            active_episode_title: 'Episode 2',
            active_episode_release_at: '2024-01-02T00:00:00.000Z',
            active_position_seconds: 120,
            active_duration_seconds: 2400,
            active_progress_percent: 5,
            last_activity_at: '2024-01-02T00:00:00.000Z',
          },
        ],
      };
    },
  } as never;

  const page = await service.listContinueWatchingPage(client, 'profile-1', { limit: 1 });

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.title, 'Valid Movie');
  assert.equal(page.pageInfo.hasMore, true);
  assert.equal(page.pageInfo.nextCursor, 'eyJ2IjoxLCJzIjoiMjAyNC0wMS0wM1QwMDowMDowMC4wMDBaIiwidCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiJ9');
  assert.match(queries[0]?.sql ?? '', /title_text IS NOT NULL/);
  assert.match(queries[0]?.sql ?? '', /title_poster_url IS NOT NULL/);
});

test('listWatchHistoryPage collapses repeated entries to one title row and paginates by title id', { concurrency: false }, async () => {
  const service = new WatchQueryService();
  const watchedAt = '2024-01-03T00:00:00.000Z';
  const firstRow = createTitleFeedRow({
    id: '11111111-1111-4111-8111-111111111111',
    title_content_id: '11111111-1111-4111-8111-111111111111',
    watched_at: watchedAt,
    title_media_key: 'movie:tmdb:42',
    title_media_type: 'movie',
    title_text: 'Example Movie',
  });
  const secondRow = createTitleFeedRow({
    id: '22222222-2222-4222-8222-222222222222',
    title_content_id: '22222222-2222-4222-8222-222222222222',
    watched_at: watchedAt,
    title_media_key: 'movie:tmdb:43',
    title_media_type: 'movie',
    title_text: 'Second Movie',
  });
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (!params?.[1]) {
        return { rows: [firstRow, secondRow] };
      }
      assert.deepEqual(params, ['profile-1', watchedAt, '11111111-1111-4111-8111-111111111111', 2]);
      return { rows: [secondRow] };
    },
  } as never;

  const page1 = await service.listWatchHistoryPage(client, 'profile-1', { limit: 1 });

  assert.equal(page1.items.length, 1);
  assert.equal(page1.items[0]?.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(page1.items[0]?.mediaKey, 'movie:tmdb:42');
  assert.equal(page1.items[0]?.watchedAt, watchedAt);
  assert.equal(page1.pageInfo.hasMore, true);
  assert.deepEqual(decodeCursor(page1.pageInfo.nextCursor), {
    v: 1,
    s: watchedAt,
    t: '11111111-1111-4111-8111-111111111111',
  });
  assert.match(queries[0]?.sql ?? '', /FROM profile_title_projection/);
  assert.match(queries[0]?.sql ?? '', /ORDER BY last_watched_at DESC, title_content_id DESC/);

  const page2 = await service.listWatchHistoryPage(client, 'profile-1', { limit: 1, cursor: page1.pageInfo.nextCursor });

  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0]?.id, '22222222-2222-4222-8222-222222222222');
  assert.equal(page2.items[0]?.mediaKey, 'movie:tmdb:43');
  assert.equal(page2.pageInfo.hasMore, false);
  assert.equal(page2.pageInfo.nextCursor, null);
});

test('listWatchlistPage uses title state ids in the cursor tie-breaker', { concurrency: false }, async () => {
  const service = new WatchQueryService();
  const addedAt = '2024-01-04T00:00:00.000Z';
  const firstRow = createTitleFeedRow({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title_content_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    added_at: addedAt,
    title_media_key: 'movie:tmdb:42',
    title_media_type: 'movie',
    title_text: 'Watchlist Movie',
  });
  const secondRow = createTitleFeedRow({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title_content_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    added_at: addedAt,
    title_media_key: 'movie:tmdb:43',
    title_media_type: 'movie',
    title_text: 'Second Watchlist Movie',
  });
  const client = {
    query: async (_sql: string, params?: unknown[]) => {
      if (!params?.[1]) {
        return { rows: [firstRow, secondRow] };
      }
      assert.deepEqual(params, ['profile-1', addedAt, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2]);
      return { rows: [secondRow] };
    },
  } as never;

  const page1 = await service.listWatchlistPage(client, 'profile-1', { limit: 1 });

  assert.equal(page1.items[0]?.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.deepEqual(decodeCursor(page1.pageInfo.nextCursor), {
    v: 1,
    s: addedAt,
    t: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });

  const page2 = await service.listWatchlistPage(client, 'profile-1', { limit: 1, cursor: page1.pageInfo.nextCursor });

  assert.equal(page2.items[0]?.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(page2.pageInfo.nextCursor, null);
});

test('listRatingsPage uses title state ids in the cursor tie-breaker', { concurrency: false }, async () => {
  const service = new WatchQueryService();
  const ratedAt = '2024-01-05T00:00:00.000Z';
  const firstRow = createTitleFeedRow({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title_content_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    rated_at: ratedAt,
    rating: 8,
    title_media_key: 'movie:tmdb:42',
    title_media_type: 'movie',
    title_text: 'Rated Movie',
  });
  const secondRow = createTitleFeedRow({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title_content_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    rated_at: ratedAt,
    rating: 7,
    title_media_key: 'movie:tmdb:43',
    title_media_type: 'movie',
    title_text: 'Second Rated Movie',
  });
  const client = {
    query: async (_sql: string, params?: unknown[]) => {
      if (!params?.[1]) {
        return { rows: [firstRow, secondRow] };
      }
      assert.deepEqual(params, ['profile-1', ratedAt, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2]);
      return { rows: [secondRow] };
    },
  } as never;

  const page1 = await service.listRatingsPage(client, 'profile-1', { limit: 1 });

  assert.equal(page1.items[0]?.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(page1.items[0]?.rating, 8);
  assert.deepEqual(decodeCursor(page1.pageInfo.nextCursor), {
    v: 1,
    s: ratedAt,
    t: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });

  const page2 = await service.listRatingsPage(client, 'profile-1', { limit: 1, cursor: page1.pageInfo.nextCursor });

  assert.equal(page2.items[0]?.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(page2.items[0]?.rating, 7);
  assert.equal(page2.pageInfo.nextCursor, null);
});

test('dismissContinueWatching resolves synthetic cw2 ids through watch-v2 projection rows', { concurrency: false }, async (t) => {
  const originalConnect = db.connect;
  const v2DismissCalls: Array<Record<string, unknown>> = [];
  const recommendationCalls: Array<Record<string, unknown>> = [];

  (db as { connect: typeof db.connect }).connect = async () => ({
    query: async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] } as never;
      }
      if (sql.includes('FROM profile_title_projection') && sql.includes('SELECT active_media_key, title_media_key')) {
        assert.deepEqual(params, ['profile-1', '11111111-1111-4111-8111-111111111111']);
        return {
          rows: [
            {
              active_media_key: 'episode:tmdb:100:1:2',
              title_media_key: 'show:tmdb:100',
            },
          ],
        } as never;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release: () => {},
  }) as never;

  t.after(() => {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  });

  const service = new WatchEventIngestService(
    {
      assertOwnedProfile: async () => ({ profileGroupId: 'group-1' }),
    } as never,
    {
      buildProjection: async () => createProjection(),
      dismissContinueWatching: async (_client: unknown, args: Record<string, unknown>) => {
        v2DismissCalls.push(args);
      },
    } as never,
    {} as never,
    {} as never,
    {
      scheduleProfileGeneration: async (profileId: string, accountId: unknown, reason: string) => {
        recommendationCalls.push({ profileId, accountId, reason });
      },
    } as never,
  );

  const result = await service.dismissContinueWatching(
    'user-1',
    'profile-1',
    'cw2:11111111-1111-4111-8111-111111111111',
  );

  assert.deepEqual(result, { accepted: true, mode: 'synchronous' });
  assert.equal(v2DismissCalls.length, 1);
  assert.equal(v2DismissCalls[0]?.profileId, 'profile-1');
  assert.equal(typeof v2DismissCalls[0]?.occurredAt, 'string');
  assert.equal((v2DismissCalls[0]?.identity as { mediaKey?: string } | undefined)?.mediaKey, 'episode:tmdb:100:1:2');
  assert.deepEqual(recommendationCalls, [{ profileId: 'profile-1', accountId: undefined, reason: 'watch_event' }]);
});

test('getState returns v2 title state and expands watched episode keys from title override', { concurrency: false }, async (t) => {
  const originalConnect = db.connect;

  (db as { connect: typeof db.connect }).connect = async () => ({
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT * FROM profile_title_projection')) {
        assert.deepEqual(params, ['profile-1', '11111111-1111-4111-8111-111111111111']);
        return {
          rows: [
            {
              title_content_id: '11111111-1111-4111-8111-111111111111',
              has_in_progress: true,
              dismissed_at: null,
              active_position_seconds: 300,
              active_duration_seconds: 1800,
              active_progress_percent: 16.7,
              last_activity_at: '2024-01-03T00:00:00.000Z',
              effective_watched: true,
              last_watched_at: '2024-01-10T00:00:00.000Z',
              watchlist_present: true,
              watchlist_updated_at: '2024-01-04T00:00:00.000Z',
              rating_value: 8,
              rated_at: '2024-01-05T00:00:00.000Z',
            },
          ],
        } as never;
      }
      if (sql.includes('SELECT present, added_at') && sql.includes('FROM profile_watchlist_state')) {
        assert.deepEqual(params, ['profile-1', '11111111-1111-4111-8111-111111111111']);
        return {
          rows: [{ present: true, added_at: '2024-01-01T00:00:00.000Z' }],
        } as never;
      }
      if (sql.includes('SELECT rating, rated_at') && sql.includes('FROM profile_rating_state')) {
        assert.deepEqual(params, ['profile-1', '11111111-1111-4111-8111-111111111111']);
        return {
          rows: [{ rating: 8, rated_at: '2024-01-02T00:00:00.000Z' }],
        } as never;
      }
      if (sql.includes('SELECT override_state, applies_through_release_at') && sql.includes('FROM profile_watch_override')) {
        return {
          rows: [{ override_state: 'watched', applies_through_release_at: '2024-01-31T00:00:00.000Z' }],
        } as never;
      }
      if (sql.includes('SELECT DISTINCT content_id')) {
        return { rows: [] } as never;
      }
      if (sql.includes('SELECT target_content_id') && sql.includes("override_state = 'unwatched'")) {
        return { rows: [{ target_content_id: 'episode-content-2' }] } as never;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release: () => {},
  }) as never;

  t.after(() => {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  });

  const service = new WatchStateService(
    {
      assertOwnedProfile: async () => ({ profileGroupId: 'group-1' }),
    } as never,
    {
      buildCardView: async () => ({
        mediaKey: 'show:tmdb:100',
        mediaType: 'show',
        kind: 'title',
        provider: 'tmdb',
        providerId: '100',
        parentMediaType: null,
        parentProvider: null,
        parentProviderId: null,
        tmdbId: 100,
        showTmdbId: 100,
        seasonNumber: null,
        episodeNumber: null,
        absoluteEpisodeNumber: null,
        title: 'Example Show',
        summary: null,
        overview: null,
        artwork: {
          posterUrl: 'https://img.test/poster.jpg',
          backdropUrl: 'https://img.test/backdrop.jpg',
          stillUrl: null,
        },
        images: {
          posterUrl: 'https://img.test/poster.jpg',
          backdropUrl: 'https://img.test/backdrop.jpg',
          stillUrl: null,
          logoUrl: null,
        },
        releaseDate: '2024-01-01',
        releaseYear: 2024,
        runtimeMinutes: 45,
        rating: 8.2,
        status: null,
        subtitle: null,
      }),
    } as never,
    {
      ensureContentId: async () => '11111111-1111-4111-8111-111111111111',
      ensureEpisodeContentIds: async (
        _client: unknown,
        inputs: Array<{ providerId: string; parentProviderId: string; seasonNumber: number | null; episodeNumber: number | null }>,
      ) => new Map(
        inputs.map((input) => [
          `${input.parentProviderId}:s${input.seasonNumber}:e${input.episodeNumber}`,
          input.episodeNumber === 1 ? 'episode-content-1' : 'episode-content-2',
        ]),
      ),
      resolveContentReference: async () => null,
    } as never,
    {
      listEpisodesForShow: async () => [
        {
          showTmdbId: 100,
          seasonNumber: 1,
          episodeNumber: 1,
          airDate: '2024-01-01',
        },
        {
          showTmdbId: 100,
          seasonNumber: 1,
          episodeNumber: 2,
          airDate: '2024-01-02',
        },
      ],
    } as never,
  );

  const state = await service.getState('user-1', 'profile-1', { mediaKey: 'show:tmdb:100' });

  assert.equal(state.media.mediaType, 'show');
  assert.equal(state.progress, null);
  assert.deepEqual(state.continueWatching, {
    id: 'cw2:11111111-1111-4111-8111-111111111111',
    positionSeconds: 300,
    durationSeconds: 1800,
    progressPercent: 16.7,
    lastActivityAt: '2024-01-03T00:00:00.000Z',
  });
  assert.deepEqual(state.watched, { watchedAt: '2024-01-10T00:00:00.000Z' });
  assert.deepEqual(state.watchlist, { addedAt: '2024-01-01T00:00:00.000Z' });
  assert.deepEqual(state.rating, { value: 8, ratedAt: '2024-01-02T00:00:00.000Z' });
  assert.deepEqual(state.watchedEpisodeKeys, ['episode:tmdb:100:1:1']);
});

function createProjection() {
  return {
    detailsTitleMediaType: 'show',
    playbackMediaType: 'episode',
    playbackProvider: 'tmdb',
    playbackProviderId: '100:1:2',
    playbackParentProvider: 'tmdb',
    playbackParentProviderId: '100',
    playbackSeasonNumber: 1,
    playbackEpisodeNumber: 2,
    playbackAbsoluteEpisodeNumber: null,
    detailsStillUrl: null,
    detailsReleaseYear: 2024,
    detailsRuntimeMinutes: 45,
    detailsRating: 8.2,
    episodeTitle: 'Episode 2',
    episodeAirDate: '2024-01-02T00:00:00.000Z',
    episodeRuntimeMinutes: 45,
    episodeStillUrl: null,
    title: 'Example Show',
    subtitle: 'S1 E2',
    posterUrl: 'poster',
    backdropUrl: 'backdrop',
  };
}

function createTitleFeedRow(overrides: Record<string, unknown>) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title_content_id: '11111111-1111-4111-8111-111111111111',
    title_media_key: 'movie:tmdb:42',
    title_media_type: 'movie',
    title_text: 'Example Title',
    title_subtitle: null,
    title_poster_url: 'https://img.test/poster.jpg',
    title_backdrop_url: 'https://img.test/backdrop.jpg',
    title_release_year: 2024,
    title_runtime_minutes: 120,
    title_rating: 7.8,
    active_media_key: 'movie:tmdb:42',
    active_media_type: 'movie',
    active_provider: 'tmdb',
    active_provider_id: '42',
    active_parent_provider: null,
    active_parent_provider_id: null,
    active_season_number: null,
    active_episode_number: null,
    active_episode_title: null,
    active_episode_release_at: null,
    added_at: '2024-01-04T00:00:00.000Z',
    rated_at: '2024-01-05T00:00:00.000Z',
    rating: 8,
    watched_at: '2024-01-03T00:00:00.000Z',
    ...overrides,
  };
}

function decodeCursor(cursor: string | null) {
  assert.ok(cursor);
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
}
