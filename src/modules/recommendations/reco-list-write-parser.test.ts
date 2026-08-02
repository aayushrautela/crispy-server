import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecoListWriteRequest } from './reco-list-write-parser.js';

test('parseRecoListWriteRequest accepts a valid lists payload', () => {
  const result = parseRecoListWriteRequest({
    lists: [
      {
        sectionType: 'contentRail',
        title: 'For You',
        subtitle: 'Tuesday picks',
        items: [
          { type: 'movie', providerRefs: [{ provider: 'tmdb', providerId: '694' }], metadata: { reason: 'trending' } },
          { type: 'tv', providerRefs: [{ provider: 'tvdb', providerId: '77801' }] },
        ],
      },
    ],
  });
  assert.equal(result.lists.length, 1);
  const list = result.lists[0]!;
  assert.equal(list.sectionType, 'contentRail');
  assert.equal(list.title, 'For You');
  assert.equal(list.subtitle, 'Tuesday picks');
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0]!.type, 'movie');
  assert.deepEqual(list.items[0]!.providerRefs, [{ provider: 'tmdb', providerId: '694' }]);
  assert.deepEqual(list.items[0]!.metadata, { reason: 'trending' });
  assert.equal(list.items[1]!.metadata, undefined);
});

test('parseRecoListWriteRequest accepts trakt provider', () => {
  const result = parseRecoListWriteRequest({
    lists: [{ sectionType: 'heroCarousel', title: 'Hero', items: [{ type: 'movie', providerRefs: [{ provider: 'trakt', providerId: 'tmdb-694' }] }] }],
  });
  assert.equal(result.lists[0]!.items[0]!.providerRefs[0]!.provider, 'trakt');
});

test('parseRecoListWriteRequest rejects missing lists', () => {
  assert.throws(() => parseRecoListWriteRequest({}), (err: Error & { code?: string }) => err.code === 'INVALID_RECO_LIST_WRITE');
});

test('parseRecoListWriteRequest rejects unsupported sectionType', () => {
  assert.throws(
    () => parseRecoListWriteRequest({ lists: [{ sectionType: 'banner', title: 'X', items: [] }] }),
    (err: Error & { code?: string }) => err.code === 'INVALID_SECTION_TYPE',
  );
});

test('parseRecoListWriteRequest rejects blank title', () => {
  assert.throws(
    () => parseRecoListWriteRequest({ lists: [{ sectionType: 'contentRail', title: '   ', items: [] }] }),
    (err: Error & { code?: string }) => err.code === 'INVALID_TITLE',
  );
});

test('parseRecoListWriteRequest rejects unsupported provider', () => {
  assert.throws(
    () => parseRecoListWriteRequest({ lists: [{ sectionType: 'contentRail', title: 'X', items: [{ type: 'movie', providerRefs: [{ provider: 'fanart', providerId: '1' }] }] }] }),
    (err: Error & { code?: string }) => err.code === 'INVALID_RECOMMENDATION_PROVIDER',
  );
});

test('parseRecoListWriteRequest rejects empty providerRefs', () => {
  assert.throws(
    () => parseRecoListWriteRequest({ lists: [{ sectionType: 'contentRail', title: 'X', items: [{ type: 'movie', providerRefs: [] }] }] }),
    (err: Error & { code?: string }) => err.code === 'INVALID_PROVIDER_REF',
  );
});
