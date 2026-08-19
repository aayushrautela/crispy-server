import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

const { normalizeTraktPlayback } = await import('./trakt-import.normalizer.js');
const { createImportAccumulator } = await import('../provider-import.internals.js');

const resolvedMovie = {
  identity: { mediaKey: 'movie:tmdb:12345', provider: 'tmdb', providerId: '12345' },
  mediaType: 'movie',
  tmdbId: 12345,
  tvdbId: null,
  kitsuId: null,
} as never;

const resolveIdentity = (async () => resolvedMovie) as never;

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
