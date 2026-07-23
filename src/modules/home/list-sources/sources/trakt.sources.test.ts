import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../../test-helpers.js';

seedTestEnv();
const { parseTraktListUrl, TraktPublicListSource, TraktTrendingSource, TraktAnticipatedSource, TraktNewReleasesSource, TraktCalendarSource, TraktPopularByRegionSource } = await import('./trakt.sources.js');

test('parseTraktListUrl extracts user + list slugs from app.trakt.tv URL', () => {
  const parsed = parseTraktListUrl('https://app.trakt.tv/users/origin14/lists/director-christopher-nolan');
  assert.equal(parsed?.userSlug, 'origin14');
  assert.equal(parsed?.listSlug, 'director-christopher-nolan');
});

test('parseTraktListUrl extracts slugs from trakt.tv URL', () => {
  const parsed = parseTraktListUrl('https://trakt.tv/users/foo/lists/best-sci-fi');
  assert.equal(parsed?.userSlug, 'foo');
  assert.equal(parsed?.listSlug, 'best-sci-fi');
});

test('parseTraktListUrl returns null for invalid URLs', () => {
  assert.equal(parseTraktListUrl('https://example.com/foo'), null);
  assert.equal(parseTraktListUrl('not a url'), null);
  assert.equal(parseTraktListUrl(''), null);
});

test('TraktPublicListSource descriptor exposes presets and URL field', () => {
  const source = new TraktPublicListSource();
  const d = source.descriptor();
  assert.equal(d.id, 'trakt.public-list');
  assert.ok(d.presets && d.presets.length >= 2);
  const keys = d.configFields.map((f) => f.key);
  assert.ok(keys.includes('listUrl'));
  assert.ok(keys.includes('mediaType'));
  assert.ok(!keys.includes('userSlug'), 'userSlug no longer a top-level field — replaced by listUrl');
});

test('TraktPublicListSource suggestListKey derives from URL', () => {
  const source = new TraktPublicListSource();
  const key = source.suggestListKey({ listUrl: 'https://trakt.tv/users/origin14/lists/director-christopher-nolan' });
  assert.equal(key, 'trakt-list-origin14-director-christopher-nolan');
});

test('TraktTrendingSource descriptor has movie + show presets', () => {
  const source = new TraktTrendingSource();
  const d = source.descriptor();
  assert.equal(d.id, 'trakt.trending');
  assert.ok(d.presets && d.presets.length === 2);
  assert.equal(d.presets[0].label, 'Trending Movies');
  assert.equal(d.presets[1].label, 'Trending Shows');
});

test('TraktAnticipatedSource descriptor has presets', () => {
  const source = new TraktAnticipatedSource();
  const d = source.descriptor();
  assert.equal(d.id, 'trakt.anticipated');
  assert.ok(d.presets && d.presets.length === 2);
});

test('TraktNewReleasesSource descriptor has presets', () => {
  const source = new TraktNewReleasesSource();
  const d = source.descriptor();
  assert.equal(d.id, 'trakt.new-releases');
  assert.ok(d.presets && d.presets.length === 2);
});

test('TraktCalendarSource descriptor has preset', () => {
  const source = new TraktCalendarSource();
  const d = source.descriptor();
  assert.equal(d.id, 'trakt.calendar-shows');
  assert.ok(d.presets && d.presets.length === 1);
});

test('TraktPopularByRegionSource descriptor has presets', () => {
  const source = new TraktPopularByRegionSource();
  const d = source.descriptor();
  assert.equal(d.id, 'trakt.popular-by-region');
  assert.ok(d.presets && d.presets.length === 2);
});
