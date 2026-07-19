import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

const { db } = await import('../../../lib/db.js');
const { HomeListsRepo } = await import('../repos/home-lists.repo.js');

const TEST_MARKER = 'home-fallback-it';

async function cleanup(): Promise<void> {
  await db.query(
    `DELETE FROM home.fallback_list_versions WHERE list_key LIKE $1`,
    [TEST_MARKER + '%'],
  );
  await db.query(
    `DELETE FROM home.fallback_list_templates WHERE list_key LIKE $1`,
    [TEST_MARKER + '%'],
  );
}

beforeEach(async () => {
  await cleanup();
});

after(async () => {
  await cleanup();
  await db.end();
});

test('fallback templates persist and resolve across locales', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  await repo.upsertFallbackTemplate({
    listKey: TEST_MARKER + '_trending',
    locale: 'en',
    sectionType: 'contentRail',
    title: 'Trending',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.trending',
    sourceConfig: {},
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });
  await repo.upsertFallbackTemplate({
    listKey: TEST_MARKER + '_trending',
    locale: 'es',
    sectionType: 'contentRail',
    title: 'Tendencies',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.trending',
    sourceConfig: {},
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });

  const all = await repo.listFallbackTemplatesForLocales(['en', 'es']);
  const matching = all.filter((t) => t.listKey === TEST_MARKER + '_trending');
  assert.equal(matching.length, 2);

  const enOnly = await repo.listFallbackTemplatesForLocales(['en']);
  assert.equal(enOnly.filter((t) => t.listKey === TEST_MARKER + '_trending').length, 1);
});

test('fallback version cache round-trips and stale detection works', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  const listKey = TEST_MARKER + '_rail';
  await repo.upsertFallbackTemplate({
    listKey,
    locale: 'en',
    sectionType: 'contentRail',
    title: 'Rail',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.popular',
    sourceConfig: { mediaType: 'movie' },
    refreshMinutes: 60,
    updatedBy: TEST_MARKER,
  });

  assert.equal(await repo.getFallbackVersion(listKey, 'en', 'tmdb.popular'), null);

  await repo.saveFallbackVersion({
    listKey,
    locale: 'en',
    sourceId: 'tmdb.popular',
    sectionType: 'contentRail',
    title: 'Rail',
    subtitle: null,
    rank: 0,
    items: [{ type: 'movie', providerRefs: [{ provider: 'tmdb', providerId: '123' }], score: null, reason: null, reasonCodes: [] }],
  });

  const version = await repo.getFallbackVersion(listKey, 'en', 'tmdb.popular');
  assert.ok(version);
  assert.equal(version?.items.length, 1);
  const firstItem = version?.items[0]! as { providerRefs: Array<{ providerId: string }> };
  assert.equal(firstItem.providerRefs[0]?.providerId, '123');

  const stale = await repo.listStaleFallbackTemplates(new Date(Date.now() - 120 * 60 * 1000));
  assert.ok(stale.some((t) => t.listKey === listKey && t.locale === 'en'));

  await repo.markFallbackRefreshed(listKey, 'en');
  const staleAfter = await repo.listStaleFallbackTemplates(new Date(Date.now() - 120 * 60 * 1000));
  assert.ok(!staleAfter.some((t) => t.listKey === listKey && t.locale === 'en'));
});

test('delete removes a fallback template by listKey and locale', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  const listKey = TEST_MARKER + '_del';
  await repo.upsertFallbackTemplate({
    listKey,
    locale: 'en',
    sectionType: 'contentRail',
    title: 'Del',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.trending',
    sourceConfig: {},
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });
  await repo.deleteFallbackTemplate(listKey, 'en');
  const all = await repo.listFallbackTemplatesForLocales(['en']);
  assert.ok(!all.some((t) => t.listKey === listKey && t.locale === 'en'));
});
