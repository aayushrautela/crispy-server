import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockMetadataView, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { WatchQueryService } = await import('./watch-query.service.js');
const { WatchStateService } = await import('./watch-state.service.js');
const { WatchEventIngestService } = await import('./event-ingest.service.js');
const { db } = await import('../../lib/db.js');

test('listContinueWatchingPage emits synthetic cw2 ids from title projection rows', { concurrency: false }, async () => {
  const service = new WatchQueryService();
  const client = {
    query: async () => ({
      rows: [
        {
          title_content_id: '11111111-1111-4111-8111-111111111111',
          title_media_key: 'show:tvdb:100',
          title_media_type: 'show',
          title_text: 'Example Show',
          title_subtitle: null,
          title_poster_url: 'https://img.test/poster.jpg',
          title_backdrop_url: 'https://img.test/backdrop.jpg',
          title_release_year: 2024,
          title_runtime_minutes: 45,
          title_rating: 8.2,
          active_media_key: 'episode:tvdb:100:1:2',
          active_media_type: 'episode',
          active_provider: 'tvdb',
          active_provider_id: '100:1:2',
          active_parent_provider: 'tvdb',
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
  assert.equal(page.items[0]?.mediaKey, 'episode:tvdb:100:1:2');
  assert.equal(page.items[0]?.title, 'Example Show');
  assert.equal(page.pageInfo.hasMore, false);
  assert.equal(page.pageInfo.nextCursor, null);
});

test('dismissContinueWatching resolves synthetic cw2 ids through watch-v2 projection rows', { concurrency: false }, async (t) => {
  const originalConnect = db.connect;
  const notifications: Array<Record<string, unknown>> = [];
  const v2DismissCalls: Array<Record<string, unknown>> = [];

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
              active_media_key: 'episode:tvdb:100:1:2',
              title_media_key: 'show:tvdb:100',
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
    {
      notifyProfileChanged: async (_profileId: string, payload: Record<string, unknown>) => {
        notifications.push(payload);
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
  assert.equal((v2DismissCalls[0]?.identity as { mediaKey?: string } | undefined)?.mediaKey, 'episode:tvdb:100:1:2');
  assert.deepEqual(notifications, [{ mediaKey: 'episode:tvdb:100:1:2', refreshMetadata: false }]);
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
      buildMetadataView: async () => createMockMetadataView({
        mediaKey: 'show:tvdb:100',
        mediaType: 'show',
        provider: 'tvdb',
        providerId: '100',
        title: 'Example Show',
        releaseDate: '2024-01-01',
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
      loadIdentityContext: async () => ({
        title: null,
        currentEpisode: null,
        nextEpisode: null,
        seasons: [],
        episodes: [
          {
            mediaType: 'episode',
            provider: 'tvdb',
            providerId: '100:1:1',
            parentMediaType: 'show',
            parentProvider: 'tvdb',
            parentProviderId: '100',
            seasonNumber: 1,
            episodeNumber: 1,
            absoluteEpisodeNumber: null,
            title: 'Episode 1',
            summary: null,
            airDate: '2024-01-01',
            runtimeMinutes: 45,
            rating: null,
            stillUrl: null,
            raw: {},
          },
          {
            mediaType: 'episode',
            provider: 'tvdb',
            providerId: '100:1:2',
            parentMediaType: 'show',
            parentProvider: 'tvdb',
            parentProviderId: '100',
            seasonNumber: 1,
            episodeNumber: 2,
            absoluteEpisodeNumber: null,
            title: 'Episode 2',
            summary: null,
            airDate: '2024-01-02',
            runtimeMinutes: 45,
            rating: null,
            stillUrl: null,
            raw: {},
          },
        ],
        videos: [],
        cast: [],
        directors: [],
        creators: [],
        reviews: [],
        production: null,
        collection: null,
        similar: [],
      }),
    } as never,
  );

  const state = await service.getState('user-1', 'profile-1', { mediaKey: 'show:tvdb:100' });

  assert.equal(state.media.provider, 'tvdb');
  assert.equal(state.media.providerId, '100');
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
  assert.deepEqual(state.watchlist, { addedAt: '2024-01-04T00:00:00.000Z' });
  assert.deepEqual(state.rating, { value: 8, ratedAt: '2024-01-05T00:00:00.000Z' });
  assert.deepEqual(state.watchedEpisodeKeys, ['episode:tvdb:100:1:1']);
});

function createProjection() {
  return {
    detailsTitleMediaType: 'show',
    playbackMediaType: 'episode',
    playbackProvider: 'tvdb',
    playbackProviderId: '100:1:2',
    playbackParentProvider: 'tvdb',
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
