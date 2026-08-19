import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import {
  type ContentItemRecord,
  type ContentProviderRefInput,
  type ContentProviderRefRecord,
  type ContentRelationshipInput,
  type ContentRelationshipRecord,
  type ContentRelationshipType,
} from './content-identity.repo.js';
import { ContentIdentityService } from './content-identity.service.js';
import { assertPublicItemId, decodePublicItemId, encodePublicItemId } from './public-item-id.js';

const MOVIE_UUID = '11111111-1111-4111-8111-111111111111';
const SHOW_UUID = '22222222-2222-4222-8222-222222222222';
const EPISODE_UUID = '33333333-3333-4333-8333-333333333333';
const SEASON_UUID = '44444444-4444-4444-8444-444444444444';

function createStubRepository(options?: {
  skipBatchResults?: boolean;
  skipBatchEntityTypes?: string[];
  contentItems?: Map<string, ContentItemRecord>;
  providerRefsByContentId?: Map<string, ContentProviderRefRecord[]>;
  relationships?: ContentRelationshipRecord[];
}) {
  const calls: Array<Array<{ provider: string; entityType: string; externalId: string }>> = [];
  const relationshipCalls: ContentRelationshipInput[][] = [];
  const relationships = [...(options?.relationships ?? [])];
  const repository = {
    async ensureProviderRefs(_client: DbClient, refs: ContentProviderRefInput[]): Promise<ContentProviderRefRecord[]> {
      calls.push(refs.map((ref) => ({
        provider: ref.provider,
        entityType: ref.entityType,
        externalId: ref.externalId,
      })));

      const shouldSkipBatch = (refs.length > 1 || options?.skipBatchResults)
        && (options?.skipBatchResults
          || refs.some((ref) => options?.skipBatchEntityTypes?.includes(ref.entityType)));
      if (shouldSkipBatch) {
        return [];
      }

      return refs.map((ref) => ({
        contentId: contentIdForRef(ref),
        provider: ref.provider,
        entityType: ref.entityType,
        externalId: ref.externalId,
        metadata: ref.metadata ?? {},
      }));
    },
    async listProviderRefsByContentId(_client: DbClient, contentId: string): Promise<ContentProviderRefRecord[]> {
      return options?.providerRefsByContentId?.get(contentId) ?? [];
    },
    async findContentItemById(_client: DbClient, contentId: string): Promise<ContentItemRecord | null> {
      return options?.contentItems?.get(contentId) ?? null;
    },
    async upsertContentRelationships(_client: DbClient, inputs: ContentRelationshipInput[]): Promise<ContentRelationshipRecord[]> {
      relationshipCalls.push(inputs);
      const records = inputs.map((input) => ({
        childContentId: input.childContentId,
        parentContentId: input.parentContentId,
        relationshipType: input.relationshipType,
        metadata: input.metadata ?? {},
      }));
      relationships.push(...records);
      return records;
    },
    async upsertContentRelationship(_client: DbClient, input: ContentRelationshipInput): Promise<ContentRelationshipRecord> {
      const [record] = await this.upsertContentRelationships(_client, [input]);
      assert.ok(record);
      return record;
    },
    async findParentRelationship(
      _client: DbClient,
      childContentId: string,
      relationshipType: ContentRelationshipType,
    ): Promise<ContentRelationshipRecord | null> {
      return relationships.find((relationship) => (
        relationship.childContentId === childContentId
        && relationship.relationshipType === relationshipType
      )) ?? null;
    },
    async listParentRelationships(
      _client: DbClient,
      childContentId: string,
      relationshipTypes?: ContentRelationshipType[],
    ): Promise<ContentRelationshipRecord[]> {
      return relationships.filter((relationship) => (
        relationship.childContentId === childContentId
        && (!relationshipTypes?.length || relationshipTypes.includes(relationship.relationshipType))
      ));
    },
    async listParentRelationshipsBatch(): Promise<ContentRelationshipRecord[]> {
      return [];
    },
  };

  return {
    repository,
    calls,
    relationshipCalls,
    relationships,
  };
}

function contentIdForRef(ref: ContentProviderRefInput): string {
  if (ref.entityType === 'movie') {
    return `content-movie-${ref.externalId}`;
  }
  if (ref.entityType === 'show') {
    return ref.externalId === '44' ? SHOW_UUID : `content-show-${ref.externalId}`;
  }
  if (ref.entityType === 'episode') {
    return ref.externalId === '44:s1:e2' || ref.externalId === '44:s1:e3' ? EPISODE_UUID : `content-episode-${ref.externalId}`;
  }
  if (ref.entityType === 'season') {
    return ref.externalId === '44:s1' ? SEASON_UUID : `content-season-${ref.externalId}`;
  }
  return `content-${ref.entityType}-${ref.externalId}`;
}

function assertHttpError(statusCode: number, message: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.message, message);
    return true;
  };
}

test('public item IDs round-trip dashed UUIDs to dashless lowercase UUID hex', () => {
  const dashed = 'F137A2DD-21BB-C1B9-9AA5-C0F6BF02A805';
  const publicId = encodePublicItemId(dashed);

  assert.equal(publicId, 'f137a2dd21bbc1b99aa5c0f6bf02a805');
  assert.equal(decodePublicItemId(publicId), 'f137a2dd-21bb-c1b9-9aa5-c0f6bf02a805');
  assert.equal(assertPublicItemId(publicId), 'f137a2dd-21bb-c1b9-9aa5-c0f6bf02a805');
});

test('public item ID helpers reject provider keys, raw numeric, uppercase, short, and non-hex IDs', () => {
  for (const value of [
    'show:tmdb:1396',
    '1396',
    'F137A2DD21BBC1B99AA5C0F6BF02A805',
    'f137a2dd21bbc1b99aa5c0f6bf02a80',
    'f137a2dd21bbc1b99aa5c0f6bf02z805',
  ]) {
    assert.throws(() => assertPublicItemId(value), assertHttpError(400, 'Invalid item id.'));
  }
});

test('ensureContentIds resolves all content ids in a single batch call', async () => {
  const { repository, calls } = createStubRepository();
  const service = new ContentIdentityService(repository as never);

  const identities = [
    inferMediaIdentity({ mediaType: 'movie', tmdbId: 77 }),
    inferMediaIdentity({ mediaType: 'show', tmdbId: 88 }),
  ];

  const contentIds = await service.ensureContentIds({} as never, identities);

  assert.equal(contentIds.get('movie:tmdb:77'), 'content-movie-77');
  assert.equal(contentIds.get('show:tmdb:88'), 'content-show-88');
  assert.deepEqual(calls, [
    [
      { provider: 'tmdb', entityType: 'movie', externalId: '77' },
      { provider: 'tmdb', entityType: 'show', externalId: '88' },
    ],
  ]);
});

test('ensureContentIds resolves duplicated title refs after provider-ref deduplication', async () => {
  const repository = {
    async ensureProviderRefs(_client: DbClient, refs: ContentProviderRefInput[]): Promise<ContentProviderRefRecord[]> {
      const seen = new Set<string>();
      const deduped = refs.filter((ref) => {
        const key = `${ref.provider}:${ref.entityType}:${ref.externalId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return deduped.map((ref) => ({
        contentId: contentIdForRef(ref),
        provider: ref.provider,
        entityType: ref.entityType,
        externalId: ref.externalId,
        metadata: ref.metadata ?? {},
      }));
    },
  } as never;

  const service = new ContentIdentityService(repository as never);

  const show = inferMediaIdentity({ mediaType: 'show', tmdbId: 44 });
  const ep2 = inferMediaIdentity({ mediaType: 'episode', showTmdbId: 44, seasonNumber: 1, episodeNumber: 2 });
  const ep3 = inferMediaIdentity({ mediaType: 'episode', showTmdbId: 44, seasonNumber: 1, episodeNumber: 3 });

  const contentIds = await service.ensureContentIds({} as never, [show, ep2, show, ep3]);

  assert.equal(contentIds.get('show:tmdb:44'), SHOW_UUID);
  assert.equal(contentIds.get('episode:tmdb:44:1:2'), EPISODE_UUID);
  assert.equal(contentIds.get('episode:tmdb:44:1:3'), EPISODE_UUID);
  assert.equal(contentIds.size, 3);
});

test('ensureTitleContentIds resolves all content ids in a single batch call', async () => {
  const { repository, calls } = createStubRepository();
  const service = new ContentIdentityService(repository as never);

  const contentIds = await service.ensureTitleContentIds({} as never, [
    { mediaType: 'movie', provider: 'tmdb', providerId: 77 },
    { mediaType: 'show', provider: 'tmdb', providerId: 88 },
  ]);

  assert.equal(contentIds.get('movie:77'), 'content-movie-77');
  assert.equal(contentIds.get('show:88'), 'content-show-88');
  assert.deepEqual(calls, [
    [
      { provider: 'tmdb', entityType: 'movie', externalId: '77' },
      { provider: 'tmdb', entityType: 'show', externalId: '88' },
    ],
  ]);
});

test('ensureEpisodeContentIds materializes episode, series, season, and relationships in a single batch call', async () => {
  const { repository, calls, relationshipCalls } = createStubRepository();
  const service = new ContentIdentityService(repository as never);

  const contentIds = await service.ensureEpisodeContentIds({} as never, [
    { parentMediaType: 'show', provider: 'tmdb', parentProviderId: 44, seasonNumber: 1, episodeNumber: 2 },
    { parentMediaType: 'show', provider: 'tmdb', parentProviderId: 44, seasonNumber: 1, episodeNumber: 3 },
  ]);

  assert.equal(contentIds.get('44:s1:e2'), EPISODE_UUID);
  assert.equal(contentIds.get('44:s1:e3'), EPISODE_UUID);
  assert.deepEqual(calls, [
    [
      { provider: 'tmdb', entityType: 'episode', externalId: '44:s1:e2' },
      { provider: 'tmdb', entityType: 'episode', externalId: '44:s1:e3' },
      { provider: 'tmdb', entityType: 'show', externalId: '44' },
      { provider: 'tmdb', entityType: 'season', externalId: '44:s1' },
    ],
  ]);
  assert.deepEqual(
    relationshipCalls[0]?.map((relationship) => ({
      childContentId: relationship.childContentId,
      parentContentId: relationship.parentContentId,
      relationshipType: relationship.relationshipType,
    })),
    [
      { childContentId: EPISODE_UUID, parentContentId: SHOW_UUID, relationshipType: 'series' },
      { childContentId: EPISODE_UUID, parentContentId: SEASON_UUID, relationshipType: 'season' },
      { childContentId: SEASON_UUID, parentContentId: SHOW_UUID, relationshipType: 'series' },
      { childContentId: EPISODE_UUID, parentContentId: SHOW_UUID, relationshipType: 'series' },
      { childContentId: EPISODE_UUID, parentContentId: SEASON_UUID, relationshipType: 'season' },
      { childContentId: SEASON_UUID, parentContentId: SHOW_UUID, relationshipType: 'series' },
    ],
  );
});

test('ensureSeasonContentIds resolves all content ids and materializes series relationships', async () => {
  const { repository, calls, relationshipCalls } = createStubRepository();
  const service = new ContentIdentityService(repository as never);

  const contentIds = await service.ensureSeasonContentIds({} as never, {
    parentMediaType: 'show',
    provider: 'tmdb',
    parentProviderId: 44,
  }, [1, 2]);

  assert.equal(contentIds.get(1), SEASON_UUID);
  assert.equal(contentIds.get(2), 'content-season-44:s2');
  assert.deepEqual(calls, [
    [
      { provider: 'tmdb', entityType: 'show', externalId: '44' },
      { provider: 'tmdb', entityType: 'season', externalId: '44:s1' },
      { provider: 'tmdb', entityType: 'season', externalId: '44:s2' },
    ],
  ]);
  assert.equal(relationshipCalls[0]?.length, 2);
  assert.deepEqual(relationshipCalls[0]?.[0], {
    childContentId: SEASON_UUID,
    parentContentId: SHOW_UUID,
    relationshipType: 'series',
    metadata: {
      provider: 'tmdb',
      parentMediaType: 'show',
      parentProviderId: '44',
      seasonNumber: 1,
    },
  });
});

test('ensureContentIds returns empty map when batch returns no results', async () => {
  const { repository } = createStubRepository({ skipBatchResults: true, skipBatchEntityTypes: ['movie'] });
  const service = new ContentIdentityService(repository as never);

  const identities = [
    inferMediaIdentity({ mediaType: 'movie', tmdbId: 77 }),
  ];

  const contentIds = await service.ensureContentIds({} as never, identities);
  assert.equal(contentIds.has('movie:tmdb:77'), false);
  assert.equal(contentIds.size, 0);
});

test('resolveProviderRefsForItemId validates public IDs before lookup', async () => {
  const { repository } = createStubRepository();
  const service = new ContentIdentityService(repository as never);

  await assert.rejects(
    () => service.resolveProviderRefsForItemId({} as never, 'show:tmdb:1396'),
    assertHttpError(400, 'Invalid item id.'),
  );
});

test('resolveProviderRefsForItemId decodes item ID and returns provider refs', async () => {
  const refs: ContentProviderRefRecord[] = [{
    contentId: MOVIE_UUID,
    provider: 'tvdb',
    entityType: 'movie',
    externalId: 'tv-77',
    metadata: {},
  }];
  const { repository } = createStubRepository({
    contentItems: new Map([[MOVIE_UUID, { contentId: MOVIE_UUID, entityType: 'movie' }]]),
    providerRefsByContentId: new Map([[MOVIE_UUID, refs]]),
  });
  const service = new ContentIdentityService(repository as never);

  assert.deepEqual(await service.resolveProviderRefsForItemId({} as never, encodePublicItemId(MOVIE_UUID)), refs);
});

test('resolveParentItemIdsForEpisode returns relationship-backed public parent IDs', async () => {
  const { repository } = createStubRepository({
    contentItems: new Map([[EPISODE_UUID, { contentId: EPISODE_UUID, entityType: 'episode' }]]),
    relationships: [
      { childContentId: EPISODE_UUID, parentContentId: SHOW_UUID, relationshipType: 'series', metadata: {} },
      { childContentId: EPISODE_UUID, parentContentId: SEASON_UUID, relationshipType: 'season', metadata: {} },
    ],
  });
  const service = new ContentIdentityService(repository as never);

  assert.deepEqual(await service.resolveParentItemIdsForEpisode({} as never, encodePublicItemId(EPISODE_UUID)), {
    seriesItemId: encodePublicItemId(SHOW_UUID),
    seasonItemId: encodePublicItemId(SEASON_UUID),
  });
});

test('resolveTitleItemIdForPlayableItemId returns self for movies and series parent for episodes', async () => {
  const { repository } = createStubRepository({
    contentItems: new Map([
      [MOVIE_UUID, { contentId: MOVIE_UUID, entityType: 'movie' }],
      [EPISODE_UUID, { contentId: EPISODE_UUID, entityType: 'episode' }],
    ]),
    relationships: [
      { childContentId: EPISODE_UUID, parentContentId: SHOW_UUID, relationshipType: 'series', metadata: {} },
    ],
  });
  const service = new ContentIdentityService(repository as never);

  assert.equal(
    (await service.resolveTitleItemIdForPlayableItemId({} as never, encodePublicItemId(MOVIE_UUID))).publicTitleItemId,
    encodePublicItemId(MOVIE_UUID),
  );
  assert.equal(
    (await service.resolveTitleItemIdForPlayableItemId({} as never, encodePublicItemId(EPISODE_UUID))).publicTitleItemId,
    encodePublicItemId(SHOW_UUID),
  );
});

test('resolveContentReference falls back deterministically when TMDB ref is absent', async () => {
  const tvdbRef: ContentProviderRefRecord = {
    contentId: SHOW_UUID,
    provider: 'tvdb',
    entityType: 'show',
    externalId: '81189',
    metadata: {},
  };
  const { repository } = createStubRepository({
    contentItems: new Map([[SHOW_UUID, { contentId: SHOW_UUID, entityType: 'show' }]]),
    providerRefsByContentId: new Map([[SHOW_UUID, [tvdbRef]]]),
  });
  const service = new ContentIdentityService(repository as never);

  const reference = await service.resolveContentReference({} as never, SHOW_UUID);

  assert.equal(reference.entityType, 'show');
  assert.equal(reference.itemId, encodePublicItemId(SHOW_UUID));
  assert.equal(reference.authorityRef, tvdbRef);
  if (reference.entityType === 'show') {
    assert.equal(reference.mediaIdentity.provider, 'tvdb');
    assert.equal(reference.mediaIdentity.providerId, '81189');
  }
});

test('resolveContentReference treats existing anime rows as show references', async () => {
  const tvdbRef: ContentProviderRefRecord = {
    contentId: SHOW_UUID,
    provider: 'tvdb',
    entityType: 'show',
    externalId: '81189',
    metadata: {},
  };
  const { repository } = createStubRepository({
    contentItems: new Map([[SHOW_UUID, { contentId: SHOW_UUID, entityType: 'anime' }]]),
    providerRefsByContentId: new Map([[SHOW_UUID, [tvdbRef]]]),
  });
  const service = new ContentIdentityService(repository as never);

  const reference = await service.resolveContentReference({} as never, SHOW_UUID);

  assert.equal(reference.entityType, 'show');
});
