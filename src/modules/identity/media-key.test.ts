import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { canonicalContinueWatchingMediaKey, parseMediaKey } from './media-key.js';

test('canonicalContinueWatchingMediaKey collapses episodes to the parent show key', () => {
  assert.equal(
    canonicalContinueWatchingMediaKey({
      mediaKey: 'episode:tmdb:55:2:4',
      mediaType: 'episode',
      tmdbId: null,
      showTmdbId: 55,
      seasonNumber: 2,
      episodeNumber: 4,
      parentProvider: 'tmdb',
      parentProviderId: '55',
    }),
    'show:tmdb:55',
  );
});

test('canonicalContinueWatchingMediaKey preserves movie and show identities', () => {
  assert.equal(
    canonicalContinueWatchingMediaKey({
      mediaKey: 'movie:tmdb:77',
      mediaType: 'movie',
      tmdbId: 77,
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
    }),
    'movie:tmdb:77',
  );

  assert.equal(
    canonicalContinueWatchingMediaKey({
      mediaKey: 'show:tmdb:88',
      mediaType: 'show',
      provider: 'tmdb',
      providerId: '88',
      tmdbId: 88,
      showTmdbId: 88,
      seasonNumber: null,
      episodeNumber: null,
    }),
    'show:tmdb:88',
  );
});

test('canonicalContinueWatchingMediaKey rejects unsupported incomplete identities', () => {
  assert.throws(
    () => canonicalContinueWatchingMediaKey({
      mediaKey: 'episode:tmdb:unknown',
      mediaType: 'episode',
      tmdbId: null,
      showTmdbId: null,
      seasonNumber: 1,
      episodeNumber: 1,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'Unsupported media key format.');
      return true;
    },
  );
});

test('parseMediaKey accepts TMDB show media keys', () => {
  assert.deepEqual(parseMediaKey('show:tmdb:88'), {
    mediaKey: 'show:tmdb:88',
    mediaType: 'show',
    provider: 'tmdb',
    providerId: '88',
    tmdbId: 88,
    showTmdbId: 88,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    parentProvider: null,
    parentProviderId: null,
    contentId: null,
    parentContentId: null,
    providerMetadata: {},
  });
});
