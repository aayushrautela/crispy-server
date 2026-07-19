import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();
const { localeCandidates, resolveTemplatesByLocale, FALLBACK_SECTION_LIMITS } = await import('./home-fallback.service.js');

test('localeCandidates falls through to en with primary tag before generic', () => {
  assert.deepEqual(localeCandidates('en-US'), ['en-US', 'en']);
  assert.deepEqual(localeCandidates('en'), ['en']);
  assert.deepEqual(localeCandidates('es-MX'), ['es-MX', 'es', 'en']);
});

test('resolveTemplatesByLocale prefers most specific locale, one per listKey', () => {
  const all = [
    { listKey: 'trending', locale: 'en', sectionType: 'contentRail', title: '', subtitle: null, rank: 0, sourceId: 'tmdb.trending', sourceConfig: {} },
    { listKey: 'trending', locale: 'en-US', sectionType: 'contentRail', title: 'US', subtitle: null, rank: 0, sourceId: 'tmdb.trending', sourceConfig: {} },
    { listKey: 'popular', locale: 'en', sectionType: 'contentRail', title: 'Pop', subtitle: null, rank: 0, sourceId: 'tmdb.popular', sourceConfig: {} },
  ];
  const resolved = resolveTemplatesByLocale(all, localeCandidates('en-US'));
  const byKey = new Map(resolved.map((t) => [t.listKey, t]));
  assert.equal(byKey.get('trending')?.locale, 'en-US', 'prefers en-US over en');
  assert.equal(byKey.get('popular')?.locale, 'en');
  assert.equal(resolved.length, 2);
});

test('FALLBACK_SECTION_LIMITS defines limits per section', () => {
  assert.equal(FALLBACK_SECTION_LIMITS.heroCarousel, 10);
  assert.equal(FALLBACK_SECTION_LIMITS.contentRail, 100);
});
