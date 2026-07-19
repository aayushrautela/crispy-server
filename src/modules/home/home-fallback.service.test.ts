import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();
const { localeCandidates, resolveTemplatesByLocale, resolveFallbackTemplatesForViewer, FALLBACK_SECTION_LIMITS } = await import('./home-fallback.service.js');

function template(partial: Partial<{
  listKey: string;
  locale: string;
  localeMode: 'auto' | 'specific' | 'en';
  regionOverride: string | null;
  sectionType: string;
  title: string;
  subtitle: string | null;
  rank: number;
  sourceId: string;
  sourceConfig: Record<string, unknown>;
}>): {
  listKey: string;
  locale: string;
  localeMode: 'auto' | 'specific' | 'en';
  regionOverride: string | null;
  sectionType: string;
  title: string;
  subtitle: string | null;
  rank: number;
  sourceId: string;
  sourceConfig: Record<string, unknown>;
} {
  return {
    listKey: 'trending',
    locale: 'en',
    localeMode: 'auto',
    regionOverride: null,
    sectionType: 'contentRail',
    title: '',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.discover-filtered',
    sourceConfig: {},
    ...partial,
  };
}

test('localeCandidates falls through to en with primary tag before generic', () => {
  assert.deepEqual(localeCandidates('en-US'), ['en-US', 'en']);
  assert.deepEqual(localeCandidates('en'), ['en']);
  assert.deepEqual(localeCandidates('es-MX'), ['es-MX', 'es', 'en']);
});

test('resolveTemplatesByLocale prefers specific locale, auto loses to specific, one per listKey', () => {
  const all = [
    template({ listKey: 'trending', locale: 'en', localeMode: 'auto' }),
    template({ listKey: 'trending', locale: 'en-US', localeMode: 'specific', title: 'US' }),
    template({ listKey: 'popular', locale: 'en', localeMode: 'auto', title: 'Pop' }),
  ];
  const resolved = resolveTemplatesByLocale(all, localeCandidates('en-US'));
  const byKey = new Map(resolved.map((t) => [t.listKey, t]));
  assert.equal(byKey.get('trending')?.locale, 'en-US', 'specific en-US beats auto');
  assert.equal(byKey.get('popular')?.localeMode, 'auto', 'auto still applies when no specific match');
  assert.equal(resolved.length, 2);
});

test('resolveFallbackTemplatesForViewer includes auto rows for any locale', () => {
  const all = [
    template({ listKey: 'trending', locale: 'en', localeMode: 'auto' }),
    template({ listKey: 'popular', locale: 'pl', localeMode: 'specific' }),
  ];
  const pl = resolveFallbackTemplatesForViewer(all, 'pl');
  const de = resolveFallbackTemplatesForViewer(all, 'de');
  const plKeys = new Set(pl.map((t) => t.listKey));
  const deKeys = new Set(de.map((t) => t.listKey));
  assert.ok(plKeys.has('trending') && plKeys.has('popular'), 'pl sees both auto + pl-specific');
  assert.ok(deKeys.has('trending') && !deKeys.has('popular'), 'de sees auto but not pl-specific');
});

test('FALLBACK_SECTION_LIMITS defines limits per section', () => {
  assert.equal(FALLBACK_SECTION_LIMITS.heroCarousel, 10);
  assert.equal(FALLBACK_SECTION_LIMITS.contentRail, 100);
});
