import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import { HttpError } from '../../lib/errors.js';

seedTestEnv({ OMDB_API_KEYS: '' });

const passthroughTransaction = async <T>(work: (client: never) => Promise<T>): Promise<T> => work({} as never);

test('getTitleContent requires an account OMDb key when no server keys configured', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');

  const service = new MetadataDirectService(
    {} as never, {} as never, {} as never, {} as never,
    { listOmdbApiKeysForLookup: async () => ({ ownKeys: [], pooledKeys: [] }) } as never,
    (async () => new Response('{}', { status: 200 })) as never,
    { findByImdbId: async () => null, upsert: async (_c: unknown, _id: string, p: Record<string, unknown>) => p } as never,
    passthroughTransaction,
  );

  service.resolveMetadataView = async function () {
    return { id: 'uuid-1', mediaKey: 'movie:tmdb:55', mediaType: 'movie', kind: 'title', tmdbId: 55, showTmdbId: null, seasonNumber: null, episodeNumber: null, title: 'Movie', subtitle: null, summary: null, overview: null, artwork: { posterUrl: null, backdropUrl: null, stillUrl: null }, images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null }, releaseDate: null, releaseYear: null, runtimeMinutes: null, rating: null, certification: null, status: null, genres: [], externalIds: { tmdb: 55, imdb: 'tt1234567', tvdb: null }, seasonCount: null, episodeCount: null, nextEpisode: null } as never;
  };

  await assert.rejects(
    () => service.getTitleContent('user-1', 'uuid-1'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 412);
      return true;
    },
  );
});

test('getTitleContent resolves OMDb content with valid key', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');

  let requestedUrl = '';
  const service = new MetadataDirectService(
    {} as never, {} as never, {} as never, {} as never,
    { listOmdbApiKeysForLookup: async () => ({ ownKeys: ['omdb-key'], pooledKeys: [] }) } as never,
    (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ Response: 'True', imdbID: 'tt1234567', Title: 'Example Movie', Type: 'movie', Genre: 'Drama' }), { status: 200 });
    }) as never,
    { findByImdbId: async () => null, upsert: async (_c: unknown, _id: string, p: Record<string, unknown>) => p } as never,
    passthroughTransaction,
  );

  service.resolveMetadataView = async function () {
    return { id: 'uuid-1', mediaKey: 'movie:tmdb:55', mediaType: 'movie', kind: 'title', tmdbId: 55, showTmdbId: null, seasonNumber: null, episodeNumber: null, title: 'Movie', subtitle: null, summary: null, overview: null, artwork: { posterUrl: null, backdropUrl: null, stillUrl: null }, images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null }, releaseDate: null, releaseYear: null, runtimeMinutes: null, rating: null, certification: null, status: null, genres: [], externalIds: { tmdb: 55, imdb: 'tt1234567', tvdb: null }, seasonCount: null, episodeCount: null, nextEpisode: null } as never;
  };

  const result = await service.getTitleContent('user-1', 'uuid-1');
  assert.match(requestedUrl, /apikey=omdb-key/);
  assert.equal(result.omdb.imdbId, 'tt1234567');
  assert.equal(result.omdb.title, 'Example Movie');
});

test('getTitleContent returns cached OMDb content without fetching', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');
  let fetchCalled = false;

  const service = new MetadataDirectService(
    {} as never, {} as never, {} as never, {} as never,
    { listOmdbApiKeysForLookup: async () => ({ ownKeys: ['key'], pooledKeys: [] }) } as never,
    (async () => { fetchCalled = true; return new Response('{}', { status: 200 }); }) as never,
    { findByImdbId: async () => ({ imdbId: 'tt1234567', title: 'Cached Movie' }), upsert: async () => ({}) } as never,
    passthroughTransaction,
  );

  service.resolveMetadataView = async function () {
    return { id: 'uuid-1', mediaKey: 'movie:tmdb:55', mediaType: 'movie', kind: 'title', tmdbId: 55, showTmdbId: null, seasonNumber: null, episodeNumber: null, title: 'Movie', subtitle: null, summary: null, overview: null, artwork: { posterUrl: null, backdropUrl: null, stillUrl: null }, images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null }, releaseDate: null, releaseYear: null, runtimeMinutes: null, rating: null, certification: null, status: null, genres: [], externalIds: { tmdb: 55, imdb: 'tt1234567', tvdb: null }, seasonCount: null, episodeCount: null, nextEpisode: null } as never;
  };

  const result = await service.getTitleContent('user-1', 'uuid-1');
  assert.equal(result.omdb.title, 'Cached Movie');
  assert.equal(fetchCalled, false);
});
