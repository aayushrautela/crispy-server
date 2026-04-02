import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import { HttpError } from '../../lib/errors.js';

seedTestEnv({ MDBLIST_API_KEY: '' });

test('getTitleContent requires MDBList key when not configured', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');

  const service = new MetadataDirectService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    (async () => new Response('{}', { status: 200 })) as never,
  );

  service.resolveTitleMetadataView = async function () {
    return { mediaType: 'movie', kind: 'title', provider: 'tmdb', providerId: '55', parentMediaType: null, parentProvider: null, parentProviderId: null, tmdbId: 55, showTmdbId: null, seasonNumber: null, episodeNumber: null, absoluteEpisodeNumber: null, title: 'Movie', subtitle: null, summary: null, overview: null, artwork: { posterUrl: null, backdropUrl: null, stillUrl: null }, images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null }, releaseDate: null, releaseYear: null, runtimeMinutes: null, rating: null, certification: null, status: null, genres: [], externalIds: { tmdb: 55, imdb: 'tt1234567', tvdb: null, kitsu: null }, seasonCount: null, episodeCount: null, nextEpisode: null } as never;
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

test('getTitleContent resolves MDBList content with valid key', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');

  const service = new MetadataDirectService();

  (service as any).mdblistService = {
    getTitle: async () => ({
      ids: { imdb: 'tt1234567', tmdb: 55, trakt: null, tvdb: null },
      title: 'Example Movie',
      originalTitle: null,
      type: 'movie',
      year: 2024,
      description: 'A movie',
      score: 85,
      ratings: { imdbRating: 7.5, imdbVotes: 1000, tmdbRating: 7.8, metacritic: 70, rottenTomatoes: 80, letterboxdRating: null, mdblistRating: 85 },
      posterUrl: null,
      backdropUrl: null,
      genres: ['Drama'],
      keywords: [],
      runtime: 120,
      certification: null,
      released: null,
      language: 'en',
      country: 'US',
      seasonCount: null,
      episodeCount: null,
      directors: [],
      writers: [],
      network: null,
      studio: null,
      status: 'Released',
      budget: null,
      revenue: null,
      updatedAt: null,
    }),
  };

  service.resolveTitleMetadataView = async function () {
    return { mediaType: 'movie', kind: 'title', provider: 'tmdb', providerId: '55', parentMediaType: null, parentProvider: null, parentProviderId: null, tmdbId: 55, showTmdbId: null, seasonNumber: null, episodeNumber: null, absoluteEpisodeNumber: null, title: 'Movie', subtitle: null, summary: null, overview: null, artwork: { posterUrl: null, backdropUrl: null, stillUrl: null }, images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null }, releaseDate: null, releaseYear: null, runtimeMinutes: null, rating: null, certification: null, status: null, genres: [], externalIds: { tmdb: 55, imdb: 'tt1234567', tvdb: null, kitsu: null }, seasonCount: null, episodeCount: null, nextEpisode: null } as never;
  };

  const result = await service.getTitleContent('user-1', 'uuid-1');
  assert.equal(result.content.ids.imdb, 'tt1234567');
  assert.equal(result.content.title, 'Example Movie');
});
