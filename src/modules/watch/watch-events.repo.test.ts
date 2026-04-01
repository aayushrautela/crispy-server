import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchEventsRepository } from './watch-events.repo.js';

test('listForProfile normalizes Date occurredAt values from DB rows', async () => {
  const repo = new WatchEventsRepository();
  const client = {
    query: async () => ({
      rows: [
        {
          id: 'event-1',
          profile_id: 'profile-1',
          profile_group_id: 'group-1',
          event_type: 'mark_watched',
          media_key: 'movie:tmdb:1',
          media_type: 'movie',
          provider: 'tmdb',
          provider_id: '1',
          parent_provider: null,
          parent_provider_id: null,
          tmdb_id: 1,
          show_tmdb_id: null,
          season_number: null,
          episode_number: null,
          absolute_episode_number: null,
          title: 'Movie',
          subtitle: null,
          poster_url: null,
          backdrop_url: null,
          position_seconds: null,
          duration_seconds: null,
          rating: null,
          occurred_at: new Date('2024-01-02T03:04:05.000Z'),
          payload: { source: 'import' },
        },
      ],
    }),
  } as never;

  const rows = await repo.listForProfile(client, 'profile-1');

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.occurredAt, '2024-01-02T03:04:05.000Z');
});

test('insert uses the watch_events projection contract without details_title columns', async () => {
  const repo = new WatchEventsRepository();
  let capturedQuery = '';
  let capturedValues: unknown[] = [];
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      capturedQuery = query;
      capturedValues = values;
      return {
        rows: [{
          id: 'event-1',
          profile_id: 'profile-1',
          profile_group_id: 'group-1',
          event_type: 'mark_watched',
          media_key: 'movie:tmdb:1',
          occurred_at: '2024-01-02T03:04:05.000Z',
        }],
      };
    },
  } as never;

  await repo.insert(client, {
    profileGroupId: 'group-1',
    profileId: 'profile-1',
    input: {
      clientEventId: 'client-1',
      eventType: 'mark_watched',
      mediaKey: 'movie:tmdb:1',
      mediaType: 'movie',
      occurredAt: '2024-01-02T03:04:05.000Z',
      payload: {},
    } as never,
    identity: {
      contentId: null,
      mediaKey: 'movie:tmdb:1',
      mediaType: 'movie',
      provider: 'tmdb',
      providerId: '1',
      parentContentId: null,
      parentProvider: null,
      parentProviderId: null,
      tmdbId: 1,
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
      absoluteEpisodeNumber: null,
      providerMetadata: {},
    },
    projection: {
      detailsTitleMediaType: 'movie',
      detailsStillUrl: 'still',
      detailsReleaseYear: 2024,
      detailsRuntimeMinutes: 120,
      detailsRating: 8.4,
      playbackMediaType: 'movie',
      playbackProvider: 'tmdb',
      playbackProviderId: '1',
      playbackParentProvider: null,
      playbackParentProviderId: null,
      playbackSeasonNumber: null,
      playbackEpisodeNumber: null,
      playbackAbsoluteEpisodeNumber: null,
      episodeTitle: null,
      episodeAirDate: null,
      episodeRuntimeMinutes: null,
      episodeStillUrl: null,
      title: 'Movie',
      subtitle: null,
      posterUrl: null,
      backdropUrl: null,
    },
  });

  assert.doesNotMatch(capturedQuery, /details_title\b/);
  assert.doesNotMatch(capturedQuery, /details_subtitle\b/);
  assert.doesNotMatch(capturedQuery, /details_poster_url\b/);
  assert.doesNotMatch(capturedQuery, /details_backdrop_url\b/);
  assert.doesNotMatch(capturedQuery, /details_summary\b/);
  assert.match(capturedQuery, /\$56::jsonb/);
  assert.equal(capturedValues.length, 42);
});

test('listForProfile does not select non-existent watch_events details_title columns', async () => {
  const repo = new WatchEventsRepository();
  let capturedQuery = '';
  const client = {
    query: async (query: string) => {
      capturedQuery = query;
      return { rows: [] };
    },
  } as never;

  await repo.listForProfile(client, 'profile-1');

  assert.doesNotMatch(capturedQuery, /details_title\b/);
  assert.doesNotMatch(capturedQuery, /details_subtitle\b/);
  assert.doesNotMatch(capturedQuery, /details_poster_url\b/);
  assert.doesNotMatch(capturedQuery, /details_backdrop_url\b/);
  assert.doesNotMatch(capturedQuery, /details_summary\b/);
});
