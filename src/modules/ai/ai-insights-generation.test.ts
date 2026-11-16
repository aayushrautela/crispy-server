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

test('normalizeInsightsPayload accepts the slides shape with heading and body on every slide', async () => {
  const { normalizeInsightsPayload } = await import('./ai-insights-generation.js');
  const valid = normalizeInsightsPayload({
    slides: [
      { key: 'the_good_stuff', heading: '  A twist that lands  ', body: '  good  ' },
      { key: 'standout_element', heading: 'Lead actor', body: 'c' },
      { key: 'trivia', heading: 'From a true story', body: 't' },
    ],
  });
  assert.ok(valid);
  assert.deepEqual(valid!.slides.map((slide) => slide.key), ['the_good_stuff', 'standout_element', 'trivia']);
  assert.equal(valid!.slides[0]!.heading, 'A twist that lands');
  assert.equal(valid!.slides[0]!.body, 'good');
  assert.equal(valid!.slides[1]!.heading, 'Lead actor');

  // The parser keeps the sent order; the slide builder imposes the story order.
  const reordered = normalizeInsightsPayload({
    slides: [
      { key: 'trivia', heading: 'From a true story', body: 't' },
      { key: 'standout_element', heading: 'Lead actor', body: 'c' },
      { key: 'the_good_stuff', heading: 'A twist that lands', body: 'good' },
    ],
  });
  assert.deepEqual(reordered!.slides.map((slide) => slide.key), ['trivia', 'standout_element', 'the_good_stuff']);
});

test('normalizeInsightsPayload rejects any answer that does not carry the full slide shape', async () => {
  const { normalizeInsightsPayload } = await import('./ai-insights-generation.js');
  const complete = [
    { key: 'the_good_stuff', heading: 'A twist that lands', body: 'good' },
    { key: 'standout_element', heading: 'Lead actor', body: 'c' },
    { key: 'trivia', heading: 'From a true story', body: 't' },
  ];

  // The old flat-string answer is a wrong answer now, not a headless section.
  assert.equal(
    normalizeInsightsPayload({
      the_good_stuff: 'good',
      standout_element: 'c',
      trivia: 't',
    }),
    null,
  );
  assert.equal(normalizeInsightsPayload({ slides: ['good', 'c', 't'] }), null);

  // A missing, empty or over-long heading is rejected instead of papered over.
  assert.equal(normalizeInsightsPayload({ slides: [{ key: 'standout_element', body: 'c' }, ...complete.slice(0, 1), complete[2]] }), null);
  assert.equal(normalizeInsightsPayload({ slides: [{ ...complete[1]!, heading: '   ' }, complete[0], complete[2]] }), null);
  assert.equal(normalizeInsightsPayload({ slides: [{ ...complete[1]!, heading: 'x'.repeat(200) }, complete[0], complete[2]] }), null);
  assert.equal(normalizeInsightsPayload({ slides: [{ ...complete[1]!, body: '   ' }, complete[0], complete[2]] }), null);

  // An unknown key, a missing array, or an empty array are wrong answers too.
  assert.equal(normalizeInsightsPayload({ slides: [{ ...complete[1]!, key: 'summary' }, complete[0], complete[2]] }), null);
  assert.equal(normalizeInsightsPayload({ slides: [] }), null);
  assert.equal(normalizeInsightsPayload({}), null);
});

test('normalizeInsightsPayload requires a hook, a fun fact and one review section', async () => {
  const { normalizeInsightsPayload } = await import('./ai-insights-generation.js');
  const goodStuff = { key: 'the_good_stuff', heading: 'A twist that lands', body: 'good' };
  const standout = { key: 'standout_element', heading: 'Lead actor', body: 'c' };
  const trivia = { key: 'trivia', heading: 'From a true story', body: 't' };

  // One review section is enough; the other may be omitted.
  assert.ok(normalizeInsightsPayload({ slides: [standout, trivia, goodStuff] }));
  assert.ok(normalizeInsightsPayload({ slides: [standout, trivia, { key: 'the_catch', heading: 'A slow middle', body: 'bad' }] }));
  // No review section at all, or no hook / fun fact, is a wrong answer.
  assert.equal(normalizeInsightsPayload({ slides: [standout, trivia] }), null);
  assert.equal(normalizeInsightsPayload({ slides: [goodStuff, trivia] }), null);
  assert.equal(normalizeInsightsPayload({ slides: [standout, goodStuff] }), null);

  // A repeated key keeps the first slide.
  const deduped = normalizeInsightsPayload({ slides: [standout, trivia, goodStuff, { ...trivia, body: 'second' }] });
  assert.equal(deduped!.slides.filter((slide) => slide.key === 'trivia').length, 1);
  assert.equal(deduped!.slides.find((slide) => slide.key === 'trivia')!.body, 't');
});

test('the structured output schema requires every slide field and enumerates the slide keys', async () => {
  const { AI_INSIGHTS_JSON_SCHEMA, AI_INSIGHTS_SCHEMA_NAME } = await import('./ai-insights-shape.js');
  assert.equal(AI_INSIGHTS_SCHEMA_NAME, 'ai_insights');

  const root = AI_INSIGHTS_JSON_SCHEMA as {
    required: string[];
    additionalProperties: boolean;
    properties: {
      slides: {
        items: {
          required: string[];
          additionalProperties: boolean;
          properties: { key: { enum: string[] } };
        };
      };
    };
  };
  assert.deepEqual(root.required, ['slides']);
  assert.equal(root.additionalProperties, false);
  const items = root.properties.slides.items;
  assert.deepEqual(items.required, ['key', 'heading', 'body']);
  assert.equal(items.additionalProperties, false);
  assert.deepEqual(items.properties.key.enum, ['standout_element', 'the_good_stuff', 'the_catch', 'trivia']);
});

test('generateInsightsPayload retries an invalid shape once and returns the valid retry', async () => {
  const { generateInsightsPayload } = await import('./ai-insights-generation.js');
  const prompts: string[] = [];
  const execution = {
    request: { providerId: 'test', model: 'test-model' },
    payload: {
      slides: [
        { key: 'standout_element', heading: 'Nightmareish Vibe', body: 'A hallucinogenic revenge fantasy.' },
        { key: 'the_good_stuff', heading: 'Wild Performance', body: 'An intense lead performance.' },
        { key: 'trivia', heading: 'Earlier Cult Classic', body: 'The director previously made another cult film.' },
      ],
    },
  };

  const result = await generateInsightsPayload(
    { itemId: 'item-1', locale: 'en', baseUserPrompt: 'Base title context' },
    async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1
        ? ({ request: execution.request, payload: { slides: ['flat output'] } } as never)
        : execution as never;
    },
  );

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], 'Base title context');
  assert.match(prompts[1]!, /Reminder: your previous answer did not match the required JSON shape/);
  assert.ok(result);
  assert.equal(result!.payload.slides[0]!.heading, 'Nightmareish Vibe');
});

test('generateInsightsPayload gives up after two invalid shapes', async () => {
  const { generateInsightsPayload } = await import('./ai-insights-generation.js');
  const prompts: string[] = [];

  const result = await generateInsightsPayload(
    { itemId: 'item-1', locale: 'en', baseUserPrompt: 'Base title context' },
    async (prompt) => {
      prompts.push(prompt);
      return { request: {}, payload: { slides: ['still flat'] } } as never;
    },
  );

  assert.equal(prompts.length, 2);
  assert.equal(result, null);
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
