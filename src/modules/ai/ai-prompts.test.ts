import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInsightsPrompt, buildSearchPrompt } from './ai-prompts.js';

test('search prompt uses positive, tonal-accuracy guidance with a soft list-size range', () => {
  const prompt = buildSearchPrompt('shows like harry potter', 'en-US');

  assert.match(prompt, /Focus heavily on tonal and thematic accuracy\./);
  assert.match(prompt, /User Query: "shows like harry potter"/);
  assert.match(prompt, /Return between 5 and 15 titles\./);
  assert.match(prompt, /Mixed results from movies and TV shows are allowed\./);
  assert.match(prompt, /Do not include the exact title the user is asking about\./);
  assert.match(prompt, /Preferred locale: en-US/);
  assert.match(prompt, /mediaType must be "movie" or "show"\./);
  assert.match(prompt, /\{"items":\[\{"title":"Title One","mediaType":"movie","year":1982\}/);
  assert.doesNotMatch(prompt, /Catalog scope/);
  assert.doesNotMatch(prompt, /TMDB is likely to recognize/);
});

test('search prompt reflects the requested locale', () => {
  const prompt = buildSearchPrompt('anime like naruto', 'fr-FR');

  assert.match(prompt, /Preferred locale: fr-FR/);
});

test('insights prompt treats anime-origin titles as shows in TMDB-only mode', () => {
  const prompt = buildInsightsPrompt({
    itemId: '00000000000040008000000000005114',
    mediaType: 'show',
    title: 'Fullmetal Alchemist: Brotherhood',
    year: '2009',
    description: 'Two brothers chase the philosopher\'s stone.',
    rating: '9.1',
    genres: ['Action', 'Adventure'],
    reviews: [{ author: 'A', rating: 10, content: 'Great pacing and emotional payoff.' }],
  });

  assert.match(prompt, /Media type: show/);
  assert.match(prompt, /Treat shows as ongoing stories/);
  assert.match(prompt, /the_good_stuff/);
  assert.match(prompt, /the_catch/);
  assert.match(prompt, /standout_element/);
  assert.match(prompt, /NEVER perform web searches or call external tools/);
});

test('insights prompt adds show-specific guidance', () => {
  const prompt = buildInsightsPrompt({
    itemId: '00000000000040008000000000000001',
    mediaType: 'show',
    title: 'His Dark Materials',
    year: '2019',
    description: 'A young girl uncovers a dangerous conspiracy.',
    rating: '7.8',
    genres: ['Fantasy'],
    reviews: [],
  });

  assert.match(prompt, /Media type: show/);
  assert.match(prompt, /Treat shows as ongoing stories/);
  assert.match(prompt, /momentum, episode-to-episode pull/);
  assert.match(prompt, /Return ONLY valid JSON/);
});
