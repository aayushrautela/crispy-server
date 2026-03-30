import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { RecommendationEventOutboxRepository } = await import('./recommendation-event-outbox.repo.js');

test('append aligns recommendation_event_outbox insert placeholders', async () => {
  const repository = new RecommendationEventOutboxRepository();
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      return {
        rows: [{
          id: 1,
          profile_id: values[0],
          history_generation: values[1],
          event_type: values[2],
          media_key: values[3],
          media_type: values[4],
          provider: values[5],
          provider_id: values[6],
          parent_provider: values[7],
          parent_provider_id: values[8],
          tmdb_id: values[9],
          show_tmdb_id: values[10],
          season_number: values[11],
          episode_number: values[12],
          absolute_episode_number: values[13],
          rating: values[14],
          occurred_at: values[15],
          payload: JSON.parse(String(values[16] ?? '{}')),
          created_at: '2024-01-01T00:00:00.000Z',
        }],
      };
    },
  } as never;

  await repository.append(client, {
    profileId: '11111111-1111-1111-1111-111111111111',
    historyGeneration: 7,
    eventType: 'rating_put',
    mediaKey: 'movie:tmdb:100',
    mediaType: 'movie',
    provider: 'tmdb',
    providerId: '100',
    parentProvider: null,
    parentProviderId: null,
    tmdbId: 100,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    rating: 8,
    occurredAt: '2024-01-01T00:00:00.000Z',
    payload: { source: 'test' },
  });

  const insert = queries.find((entry) => entry.text.includes('INSERT INTO recommendation_event_outbox'));
  assert.ok(insert, 'expected recommendation_event_outbox insert query');
  assert.match(insert.text, /\$15, \$16::timestamptz, \$17::jsonb/);
  assert.equal(insert.values.length, 17);
});
