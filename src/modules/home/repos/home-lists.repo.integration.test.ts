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

test('auto + specific templates resolve per viewer locale', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  await repo.upsertFallbackTemplate({
    listKey: TEST_MARKER + '_trending',
    locale: 'en',
    localeMode: 'auto',
    regionOverride: null,
    sectionType: 'contentRail',
    title: 'Trending',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.discover-filtered',
    sourceConfig: { feed: 'popular', mediaType: 'movie' },
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });
  await repo.upsertFallbackTemplate({
    listKey: TEST_MARKER + '_pl',
    locale: 'pl',
    localeMode: 'specific',
    regionOverride: null,
    sectionType: 'contentRail',
    title: 'Polish',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.discover-filtered',
    sourceConfig: { feed: 'popular', mediaType: 'movie' },
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });

  const pl = await repo.listFallbackTemplatesForViewer(['pl']);
  const matching = pl.filter((t) => t.listKey === TEST_MARKER + '_trending' || t.listKey === TEST_MARKER + '_pl');
  assert.equal(matching.length, 2, 'pl viewer sees its specific rail + the auto rail');

  const de = await repo.listFallbackTemplatesForViewer(['de']);
  const deKeys = de.map((t) => t.listKey);
  assert.ok(deKeys.includes(TEST_MARKER + '_trending') && !deKeys.includes(TEST_MARKER + '_pl'), 'de viewer sees auto but not pl-specific');
});

test('fallback version cache round-trips and stale detection skips auto', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  const listKey = TEST_MARKER + '_rail';
  await repo.upsertFallbackTemplate({
    listKey,
    locale: 'en',
    localeMode: 'specific',
    regionOverride: null,
    sectionType: 'contentRail',
    title: 'Rail',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.discover-filtered',
    sourceConfig: { feed: 'popular', mediaType: 'movie' },
    refreshMinutes: 60,
    updatedBy: TEST_MARKER,
  });

  assert.equal(await repo.getFallbackVersion(listKey, 'en', 'tmdb.discover-filtered'), null);

  await repo.saveFallbackVersion({
    listKey,
    locale: 'en',
    sourceId: 'tmdb.discover-filtered',
    sectionType: 'contentRail',
    title: 'Rail',
    subtitle: null,
    rank: 0,
    items: [{ type: 'movie', providerRefs: [{ provider: 'tmdb', providerId: '123' }], score: null, reason: null, reasonCodes: [] }],
  });

  const version = await repo.getFallbackVersion(listKey, 'en', 'tmdb.discover-filtered');
  assert.ok(version);
  assert.equal(version?.items.length, 1);
  const firstItem = version?.items[0]! as { providerRefs: Array<{ providerId: string }> };
  assert.equal(firstItem.providerRefs[0]?.providerId, '123');

  const stale = await repo.listStaleFallbackTemplates(new Date(Date.now() - 120 * 60 * 1000));
  assert.ok(stale.some((t) => t.listKey === listKey), 'specific row is eligible for cron refresh');

  await repo.markFallbackRefreshed(listKey);
  const staleAfter = await repo.listStaleFallbackTemplates(new Date(Date.now() - 120 * 60 * 1000));
  assert.ok(!staleAfter.some((t) => t.listKey === listKey));
});

test('auto templates are excluded from cron refresh eligibility', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  await repo.upsertFallbackTemplate({
    listKey: TEST_MARKER + '_auto',
    locale: 'en',
    localeMode: 'auto',
    regionOverride: null,
    sectionType: 'contentRail',
    title: 'Auto',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.discover-filtered',
    sourceConfig: { feed: 'popular', mediaType: 'movie' },
    refreshMinutes: 60,
    updatedBy: TEST_MARKER,
  });
  const stale = await repo.listStaleFallbackTemplates(new Date(Date.now() - 120 * 60 * 1000));
  assert.ok(!stale.some((t) => t.listKey === TEST_MARKER + '_auto'), 'auto rows stay out of the cron queue');
});

test('delete removes a fallback template by listKey', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  const listKey = TEST_MARKER + '_del';
  await repo.upsertFallbackTemplate({
    listKey,
    locale: 'en',
    localeMode: 'auto',
    regionOverride: null,
    sectionType: 'contentRail',
    title: 'Del',
    subtitle: null,
    rank: 0,
    sourceId: 'tmdb.discover-filtered',
    sourceConfig: {},
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });
  await repo.deleteFallbackTemplate(listKey);
  const all = await repo.listFallbackTemplatesForViewer(['en']);
  assert.ok(!all.some((t) => t.listKey === listKey));
});
