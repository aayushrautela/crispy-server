import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { NOOP_TRANSACTION, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('MetadataRatingsService prefers tmdb lookup and returns normalized ratings', async () => {
  const { MetadataRatingsService } = await import('./metadata-ratings.service.js');

  const service = new MetadataRatingsService(
    {
      loadTitleSource: async () => ({
        identity: {} as never,
        language: null,
        tmdbTitle: {
          tmdbId: 222,
          externalIds: { imdb_id: 'tt1234567' },
        },
        tmdbNextEpisode: null,
      }),
    } as never,
    {} as never,
    { resolveMdbListApiKeyForUser: async () => 'user-mdb-key' } as never,
    {
      getTitleRatings: async (_apiKey: string, mediaType: 'movie' | 'show', lookup: { provider: 'tmdb' | 'imdb'; id: number | string }) => {
        assert.equal(mediaType, 'movie');
        assert.deepEqual(lookup, { provider: 'tmdb', id: 222 });
        return {
          ratings: {
            imdb: 7.5,
            tmdb: 7.8,
            trakt: 8.1,
            metacritic: 70,
            rottenTomatoes: 80,
            audience: 82,
            letterboxd: 3.9,
            rogerEbert: 4,
          },
        };
      },
    } as never,
    NOOP_TRANSACTION,
  );

  const result = await service.getTitleRatings('user-1', 'profile-1', 'movie:tmdb:222');
  assert.equal(result.ratings.tmdb, 7.8);
  assert.equal(result.ratings.letterboxd, 3.9);
});

test('MetadataRatingsService throws 412 when MDBList key is unavailable', async () => {
  const { MetadataRatingsService } = await import('./metadata-ratings.service.js');

  const service = new MetadataRatingsService(
    {} as never,
    {} as never,
    { resolveMdbListApiKeyForUser: async () => null } as never,
    {} as never,
    NOOP_TRANSACTION,
  );

  await assert.rejects(
    () => service.getTitleRatings('user-1', 'profile-1', 'movie:tmdb:222'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 412);
      return true;
    },
  );
});
