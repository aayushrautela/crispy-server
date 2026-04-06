import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';
import { canonicalContinueWatchingMediaKey, parseMediaKey } from './media-key.js';

test('canonicalContinueWatchingMediaKey collapses episodes to the parent show key', () => {
  assert.equal(
    canonicalContinueWatchingMediaKey({
      mediaKey: 'episode:tvdb:55:2:4',
      mediaType: 'episode',
      tmdbId: null,
      showTmdbId: 55,
      seasonNumber: 2,
      episodeNumber: 4,
      parentProvider: 'tvdb',
      parentProviderId: '55',
    }),
    'show:tvdb:55',
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
      mediaKey: 'show:tvdb:88',
      mediaType: 'show',
      provider: 'tvdb',
      providerId: '88',
      tmdbId: 188,
      showTmdbId: 88,
      seasonNumber: null,
      episodeNumber: null,
    }),
    'show:tvdb:88',
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

test('parseMediaKey rejects TMDB show media keys', () => {
  assert.throws(
    () => parseMediaKey('show:tmdb:88'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, 'Unsupported media key format.');
      return true;
    },
  );
});
