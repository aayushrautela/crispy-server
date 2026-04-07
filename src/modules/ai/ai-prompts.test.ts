import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInsightsPrompt, buildSearchPrompt } from './ai-prompts.js';

test('search prompt uses mixed catalog guidance without hard category filters', () => {
  const prompt = buildSearchPrompt('shows like harry potter', 'en-US', {
    isRecommendation: true,
    anchorHint: 'harry potter',
  });

  assert.match(prompt, /Catalog scope: You may suggest movies, TV shows, or anime\./);
  assert.match(prompt, /Mixed results can come from the movie, TV series, or anime catalogs\./);
  assert.match(prompt, /The anchor can come from any franchise or medium\./);
  assert.match(prompt, /Every item must include `title` and should include `mediaType` when you know it\./);
  assert.match(prompt, /\{"items":\[\{"title":"Title One","mediaType":"movie"\}/);
  assert.doesNotMatch(prompt, /TMDB is likely to recognize/);
});

test('search prompt prefers reliable catalog titles for mixed results', () => {
  const prompt = buildSearchPrompt('anime like naruto', 'en-US', {
    isRecommendation: true,
    anchorHint: 'naruto',
  });

  assert.match(prompt, /Prefer the commonly used catalog title for each result so it can be matched reliably\./);
});

test('insights prompt adds anime-specific guidance', () => {
  const prompt = buildInsightsPrompt({
    mediaKey: 'anime:kitsu:1',
    mediaType: 'anime',
    title: 'Fullmetal Alchemist: Brotherhood',
    year: '2009',
    description: 'Two brothers chase the philosopher\'s stone.',
    rating: '9.1',
    genres: ['Action', 'Adventure'],
    reviews: [{ author: 'A', rating: 10, content: 'Great pacing and emotional payoff.' }],
  });

  assert.match(prompt, /Media type: anime/);
  assert.match(prompt, /Treat anime as its own storytelling lane/);
  assert.match(prompt, /tone shifts, character dynamics, emotional payoff, powers, lore, or visual identity/);
});

test('insights prompt adds show-specific guidance', () => {
  const prompt = buildInsightsPrompt({
    mediaKey: 'show:tvdb:1',
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
  assert.match(prompt, /momentum, episode hooks, character arcs, ensemble chemistry, or worldbuilding/);
});
