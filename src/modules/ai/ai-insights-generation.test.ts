import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { MetadataTitleDetail } from '../metadata/metadata-detail.types.js';

seedTestEnv();

function titleDetail(overrides: Record<string, unknown> = {}): MetadataTitleDetail {
  return {
    Item: {
      mediaType: 'movie',
      title: 'Test Movie',
      year: 2020,
      rating: 7.5,
      genres: ['Drama'],
      providerIds: { tmdb: '123' },
      images: { artwork: null },
      ...overrides,
    },
    NextEpisode: null,
    Videos: [],
    Cast: [],
    Creators: [],
    Directors: [],
    Production: {},
  } as unknown as MetadataTitleDetail;
}

test('normalizeInsightsPayload requires real positive or negative feedback', async () => {
  const { normalizeInsightsPayload } = await import('./ai-insights-generation.js');
  const valid = normalizeInsightsPayload({
    the_good_stuff: 'good',
    the_catch: '',
    standout_element: { tag: 'PERFORMANCE', focus: 'f', context: 'c' },
    trivia: 't',
  });
  assert.ok(valid);
  assert.equal(valid!.the_good_stuff, 'good');
  assert.equal(valid!.the_catch, null);

  assert.equal(normalizeInsightsPayload({ the_good_stuff: '', the_catch: '', standout_element: { tag: 'PERFORMANCE', focus: 'f', context: 'c' }, trivia: 't' }), null);
  assert.equal(normalizeInsightsPayload({ the_good_stuff: 'g', the_catch: '', trivia: 't' } as Record<string, unknown>), null);
  assert.equal(normalizeInsightsPayload({ the_good_stuff: 'g', the_catch: '', standout_element: { tag: 'BOGUS', focus: 'f', context: 'c' }, trivia: 't' }), null);
});

test('buildTitleInsightsContext requires a titled movie or show', async () => {
  const { buildTitleInsightsContext } = await import('./ai-insights-generation.js');
  assert.equal(buildTitleInsightsContext(titleDetail({ mediaType: 'person' }), []), null);
  assert.equal(buildTitleInsightsContext(titleDetail({ title: '' }), []), null);
  const ctx = buildTitleInsightsContext(titleDetail(), [{ author: 'a', content: 'loved it', rating: 9 } as never]);
  assert.ok(ctx);
  assert.equal(ctx!.mediaType, 'movie');
  assert.equal(ctx!.reviews.length, 1);
});

test('fetchBackdropPaths never throws and falls back to empty on bad input or TMDB error', async () => {
  const { fetchBackdropPaths } = await import('./ai-insights-generation.js');
  const badClient = { request: async () => { throw new Error('boom'); } } as never;
  assert.deepEqual(await fetchBackdropPaths(badClient, titleDetail({ mediaType: 'person' })), []);
  assert.deepEqual(await fetchBackdropPaths(badClient, titleDetail()), []);

  const okClient = { request: async () => ({ backdrops: [{ file_path: '/a.jpg' }, { file_path: '/b.jpg' }, null, { file_path: '' }] }) } as never;
  const paths = await fetchBackdropPaths(okClient, titleDetail());
  assert.deepEqual(paths, ['/a.jpg', '/b.jpg']);
});
