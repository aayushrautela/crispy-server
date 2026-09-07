import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

const { db } = await import('../../../lib/db.js');
const { HomeListsRepo } = await import('../repos/home-lists.repo.js');

const TEST_MARKER = 'home-default-it';

async function cleanup(): Promise<void> {
  await db.query(
    `DELETE FROM home.default_list_templates WHERE list_key LIKE $1`,
    [TEST_MARKER + '%'],
  );
}

beforeEach(async () => {
  await cleanup();
});

after(async () => {
  try {
    await cleanup();
  } catch {
    // DB unavailable in unit-only environments; tests above already fail.
  }
});

test('listDefaultTemplates returns all active templates ordered by rank', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  await repo.upsertDefaultTemplate({
    listKey: TEST_MARKER + '_b',
    regionOverride: null,
    sectionType: 'contentRail',
    title: 'B',
    subtitle: null,
    rank: 20,
    sourceId: 'trakt.trending',
    sourceConfig: { feed: 'popular', mediaType: 'movie' },
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });
  await repo.upsertDefaultTemplate({
    listKey: TEST_MARKER + '_a',
    regionOverride: 'US',
    sectionType: 'heroCarousel',
    title: 'A',
    subtitle: null,
    rank: 10,
    sourceId: 'trakt.trending',
    sourceConfig: {},
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });

  const all = await repo.listDefaultTemplates();
  const mine = all.filter((t) => t.listKey.startsWith(TEST_MARKER));
  assert.deepEqual(mine.map((t) => t.listKey), [TEST_MARKER + '_a', TEST_MARKER + '_b']);
  assert.equal(mine[0]!.regionOverride, 'US');
});

test('delete removes a default template by listKey', { concurrency: false }, async () => {
  const repo = new HomeListsRepo({ db });
  const listKey = TEST_MARKER + '_del';
  await repo.upsertDefaultTemplate({
    listKey,
    regionOverride: null,
    sectionType: 'contentRail',
    title: 'Del',
    subtitle: null,
    rank: 0,
    sourceId: 'trakt.trending',
    sourceConfig: {},
    refreshMinutes: null,
    updatedBy: TEST_MARKER,
  });
  await repo.deleteDefaultTemplate(listKey);
  const all = await repo.listDefaultTemplates();
  assert.ok(!all.some((t) => t.listKey === listKey));
});
