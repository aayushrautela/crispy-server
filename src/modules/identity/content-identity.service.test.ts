import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbClient } from '../../lib/db.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import type { ContentProviderRefInput, ContentProviderRefRecord } from './content-identity.repo.js';
import { ContentIdentityService } from './content-identity.service.js';

function createStubRepository(options?: {
  skipBatchResults?: boolean;
  skipBatchEntityTypes?: string[];
}) {
  const calls: Array<Array<{ provider: string; entityType: string; externalId: string }>> = [];
  const repository = {
    async ensureProviderRefs(_client: DbClient, refs: ContentProviderRefInput[]): Promise<ContentProviderRefRecord[]> {
      calls.push(refs.map((ref) => ({
        provider: ref.provider,
        entityType: ref.entityType,
        externalId: ref.externalId,
      })));

      const shouldSkipBatch = refs.length > 1
        && (options?.skipBatchResults
          || refs.some((ref) => options?.skipBatchEntityTypes?.includes(ref.entityType)));
      if (shouldSkipBatch) {
        return [];
      }

      return refs.map((ref) => ({
        contentId: `content-${ref.entityType}-${ref.externalId}`,
        provider: ref.provider,
        entityType: ref.entityType,
        externalId: ref.externalId,
        metadata: ref.metadata ?? {},
      }));
    },
    async listProviderRefsByContentId(): Promise<ContentProviderRefRecord[]> {
      return [];
    },
  };

  return {
    repository,
    calls,
  };
}

test('ensureContentIds falls back to individual materialization when batch misses refs', async () => {
  const { repository, calls } = createStubRepository({ skipBatchResults: true });
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
    [{ provider: 'tmdb', entityType: 'movie', externalId: '77' }],
    [{ provider: 'tmdb', entityType: 'show', externalId: '88' }],
  ]);
});

test('ensureTitleContentIds falls back to individual materialization when batch misses refs', async () => {
  const { repository, calls } = createStubRepository({ skipBatchEntityTypes: ['movie', 'show'] });
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
    [{ provider: 'tmdb', entityType: 'movie', externalId: '77' }],
    [{ provider: 'tmdb', entityType: 'show', externalId: '88' }],
  ]);
});

test('ensureEpisodeContentIds falls back to individual materialization when batch misses refs', async () => {
  const { repository, calls } = createStubRepository({ skipBatchEntityTypes: ['episode'] });
  const service = new ContentIdentityService(repository as never);

  const contentIds = await service.ensureEpisodeContentIds({} as never, [
    { parentMediaType: 'show', provider: 'tmdb', parentProviderId: 44, seasonNumber: 1, episodeNumber: 2 },
    { parentMediaType: 'show', provider: 'tmdb', parentProviderId: 44, seasonNumber: 1, episodeNumber: 3 },
  ]);

  assert.equal(contentIds.get('44:s1:e2'), 'content-episode-44:s1:e2');
  assert.equal(contentIds.get('44:s1:e3'), 'content-episode-44:s1:e3');
  assert.deepEqual(calls, [
    [
      { provider: 'tmdb', entityType: 'episode', externalId: '44:s1:e2' },
      { provider: 'tmdb', entityType: 'episode', externalId: '44:s1:e3' },
    ],
    [{ provider: 'tmdb', entityType: 'episode', externalId: '44:s1:e2' }],
    [{ provider: 'tmdb', entityType: 'episode', externalId: '44:s1:e3' }],
  ]);
});

test('ensureSeasonContentIds falls back to individual materialization when batch misses refs', async () => {
  const { repository, calls } = createStubRepository({ skipBatchEntityTypes: ['season'] });
  const service = new ContentIdentityService(repository as never);

  const contentIds = await service.ensureSeasonContentIds({} as never, {
    parentMediaType: 'show',
    provider: 'tmdb',
    parentProviderId: 44,
  }, [1, 2]);

  assert.equal(contentIds.get(1), 'content-season-44:s1');
  assert.equal(contentIds.get(2), 'content-season-44:s2');
  assert.deepEqual(calls, [
    [
      { provider: 'tmdb', entityType: 'season', externalId: '44:s1' },
      { provider: 'tmdb', entityType: 'season', externalId: '44:s2' },
    ],
    [{ provider: 'tmdb', entityType: 'season', externalId: '44:s1' }],
    [{ provider: 'tmdb', entityType: 'season', externalId: '44:s2' }],
  ]);
});
