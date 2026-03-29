import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInsightsPrompt, buildSearchPrompt } from './ai-prompts.js';

test('search prompt for series is provider-family aware without TMDB bias', () => {
  const prompt = buildSearchPrompt('shows like harry potter', 'series', 'en-US', {
    isRecommendation: true,
    anchorHint: 'harry potter',
  });

  assert.match(prompt, /Only suggest TV shows\./);
  assert.match(prompt, /TV show results are matched against the TV series catalog\./);
  assert.match(prompt, /The anchor can come from any franchise or medium, but every result must still match the requested catalog scope\./);
  assert.match(prompt, /Every item must include `title` and should include `mediaType` when you know it\./);
  assert.match(prompt, /\{"items":\[\{"title":"Title One","mediaType":"movie"\}/);
  assert.doesNotMatch(prompt, /TMDB is likely to recognize/);
});

test('search prompt for anime prefers anime catalog naming', () => {
  const prompt = buildSearchPrompt('anime like naruto', 'anime', 'en-US', {
    isRecommendation: true,
    anchorHint: 'naruto',
  });

  assert.match(prompt, /Only suggest anime titles\./);
  assert.match(prompt, /Anime results are matched against the anime catalog\./);
  assert.match(prompt, /Use the best-known English or romanized title/);
});

test('insights prompt adds anime-specific guidance', () => {
  const prompt = buildInsightsPrompt({
    contentId: 'anime:kitsu:1',
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
    contentId: 'show:tvdb:1',
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
