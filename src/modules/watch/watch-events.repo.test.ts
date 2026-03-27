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
          tmdb_id: 1,
          show_tmdb_id: null,
          season_number: null,
          episode_number: null,
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
