import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

const { normalizeTraktPlayback, normalizeTraktRatings } = await import('./trakt-import.normalizer.js');
const { createImportAccumulator } = await import('../provider-import.internals.js');

const resolvedMovie = {
  identity: { mediaKey: 'movie:tmdb:12345', provider: 'tmdb', providerId: '12345' },
  mediaType: 'movie',
  tmdbId: 12345,
  tvdbId: null,
  kitsuId: null,
} as never;

const resolveIdentity = (async () => resolvedMovie) as never;

test('normalizeTraktRatings maps likes and dislikes and preserves original numbers in payloads', async () => {
  for (const [rating, liked] of [[1, false], [4, false], [7, true], [8.5, true], [10, true]] as const) {
    const collector = createImportAccumulator();
    await normalizeTraktRatings([{ movie: { ids: { tmdb: 12345 } }, rating, rated_at: '2026-05-14T00:00:00.000Z' }], resolveIdentity, collector);
    assert.equal(collector.importedEvents.length, 1);
    const event = collector.importedEvents[0]!;
    assert.equal(event.liked, liked);
    assert.equal(event.payload?.origin_rating, rating);
    assert.equal(event.occurredAt, '2026-05-14T00:00:00.000Z');
    assert.equal('rating' in event, false);
  }
});

test('normalizeTraktRatings skips neutral and invalid values before resolving identity', async () => {
  const collector = createImportAccumulator();
  await normalizeTraktRatings([4.5, 5, 6, 6.9, 0, 11, null, NaN, Infinity].map((rating) => ({ movie: {}, rating })), async () => {
    assert.fail('neutral and invalid votes must not resolve identity');
  }, collector);
  assert.deepEqual(collector.importedEvents, []);
  assert.equal(collector.mediaKeysToRefresh.size, 0);
});

function moviePlaybackItem(progress: number): Record<string, unknown> {
  return {
    type: 'movie',
    movie: { ids: { tmdb: 12345 } },
    progress,
    paused_at: '2026-05-14T00:00:00.000Z',
  };
}

test('normalizeTraktPlayback: derives position_seconds from local runtime when progress is present', async () => {
  const collector = createImportAccumulator();
  const runtimeLookup = (async () => 120) as never; // 120 min -> 7200s

  await normalizeTraktPlayback([moviePlaybackItem(50)], resolveIdentity, collector, runtimeLookup);

  assert.equal(collector.importedEvents.length, 1);
  const event = collector.importedEvents[0]!;
  // 7200s * 50% = 3600s, clamped to a minimum of 1s.
  assert.equal(event.positionSeconds, 3600);
  assert.equal(event.durationSeconds, 7200);
});

test('normalizeTraktPlayback: position stays null when no runtime is available', async () => {
  const collector = createImportAccumulator();
  const runtimeLookup = (async () => null) as never; // no local runtime

  await normalizeTraktPlayback([moviePlaybackItem(50)], resolveIdentity, collector, runtimeLookup);

  assert.equal(collector.importedEvents.length, 1);
  const event = collector.importedEvents[0]!;
  assert.equal(event.positionSeconds, null, 'without a runtime the resume point cannot be derived');
});
