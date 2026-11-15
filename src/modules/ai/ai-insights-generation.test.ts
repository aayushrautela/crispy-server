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
    the_good_stuff: { heading: 'A twist that lands', text: 'good' },
    the_catch: '',
    standout_element: { heading: 'Lead actor', text: 'c' },
    trivia: { heading: 'From a true story', text: 't' },
  });
  assert.ok(valid);
  assert.equal(valid!.the_good_stuff?.text, 'good');
  assert.equal(valid!.the_good_stuff?.heading, 'A twist that lands');
  assert.equal(valid!.the_catch, null);
  assert.equal(valid!.standout_element.heading, 'Lead actor');
  assert.equal(valid!.trivia.text, 't');

  assert.equal(normalizeInsightsPayload({ the_good_stuff: '', the_catch: '', standout_element: { heading: 'h', text: 'c' }, trivia: { heading: 'h', text: 't' } }), null);
  assert.equal(normalizeInsightsPayload({ the_good_stuff: { heading: 'h', text: 'g' }, the_catch: '', trivia: { heading: 'h', text: 't' } } as Record<string, unknown>), null);
});

test('normalizeInsightsPayload keeps partial sections and drops unusable fields', async () => {
  const { normalizeInsightsPayload } = await import('./ai-insights-generation.js');
  const partial = normalizeInsightsPayload({
    the_good_stuff: { heading: 'x'.repeat(200), text: 'good' },
    the_catch: { heading: 'A slow middle', text: 'catch' },
    standout_element: { heading: 'Lead actor', text: 'c' },
    trivia: { heading: 'From a true story', text: 't' },
  });
  assert.ok(partial);
  // An unusable heading is dropped, the section itself still ships.
  assert.equal(partial!.the_good_stuff?.heading, null);
  assert.equal(partial!.the_catch?.heading, 'A slow middle');

  // A plain string is accepted as copy without a heading.
  const plain = normalizeInsightsPayload({
    the_good_stuff: 'good',
    the_catch: '',
    standout_element: { heading: 'Lead actor', text: 'c' },
    trivia: { heading: 'From a true story', text: 't' },
  });
  assert.equal(plain?.the_good_stuff?.text, 'good');
  assert.equal(plain?.the_good_stuff?.heading, null);
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

  const okClient = { request: async () => ({ backdrops: [{ file_path: '/a.jpg', iso_639_1: null }, { file_path: '/b.jpg', iso_639_1: null }, { file_path: '/en.jpg', iso_639_1: 'en' }, { file_path: '/zh.jpg', iso_639_1: 'zh' }, null, { file_path: '' }] }) } as never;
  const paths = await fetchBackdropPaths(okClient, titleDetail());
  assert.deepEqual(paths, ['/a.jpg', '/b.jpg']);
});
