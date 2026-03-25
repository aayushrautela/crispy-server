import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.AUTH_JWKS_URL ??= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.AUTH_JWT_ISSUER ??= 'https://example.supabase.co/auth/v1';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

seedTestEnv();

test('MetadataDirectService.getTitleContent resolves OMDb content for a title', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');
  let requestedUrl = '';
  const service = new MetadataDirectService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getOmdbApiKeyForUser: async (userId: string) => ({
        appUserId: userId,
        key: 'metadata.omdb_api_key',
        value: 'omdb-test-key',
      }),
    } as never,
    (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        Response: 'True',
        imdbID: 'tt1234567',
        Title: 'Example Movie',
        Type: 'movie',
        Year: '2024',
        Rated: 'PG-13',
        Released: '01 Jan 2024',
        Runtime: '120 min',
        Genre: 'Drama, Mystery',
        Director: 'A Director',
        Writer: 'A Writer',
        Actors: 'Actor One, Actor Two',
        Plot: 'A plot.',
        Language: 'English, Spanish',
        Country: 'USA',
        Awards: '1 win',
        Poster: 'https://img.test/poster.jpg',
        Ratings: [
          { Source: 'Internet Movie Database', Value: '8.7/10' },
          { Source: 'Rotten Tomatoes', Value: '95%' },
        ],
        Metascore: '79',
        imdbRating: '8.7',
        imdbVotes: '123,456',
        BoxOffice: '$10',
        Production: 'Studio',
        Website: 'https://example.com',
        totalSeasons: '3',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as never,
  );

  service.resolveMetadataView = async function () {
    return {
      id: 'crisp:movie:55',
      mediaKey: 'movie:tmdb:55',
      mediaType: 'movie',
      kind: 'title',
      tmdbId: 55,
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
      title: 'Example Movie',
      subtitle: null,
      summary: null,
      overview: null,
      artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
      images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
      releaseDate: null,
      releaseYear: null,
      runtimeMinutes: null,
      rating: null,
      certification: null,
      status: null,
      genres: [],
      externalIds: { tmdb: 55, imdb: 'tt1234567', tvdb: null },
      seasonCount: null,
      episodeCount: null,
      nextEpisode: null,
    };
  };

  const result = await service.getTitleContent('user-1', 'crisp:movie:55');

  assert.match(requestedUrl, /apikey=omdb-test-key/);
  assert.match(requestedUrl, /i=tt1234567/);
  assert.equal(result.item.id, 'crisp:movie:55');
  assert.equal(result.omdb.imdbId, 'tt1234567');
  assert.equal(result.omdb.title, 'Example Movie');
  assert.deepEqual(result.omdb.genres, ['Drama', 'Mystery']);
  assert.equal(result.omdb.imdbRating, 8.7);
  assert.equal(result.omdb.imdbVotes, 123456);
  assert.equal(result.omdb.metascore, 79);
  assert.equal(result.omdb.totalSeasons, 3);
  assert.deepEqual(result.omdb.ratings, [
    { source: 'Internet Movie Database', value: '8.7/10' },
    { source: 'Rotten Tomatoes', value: '95%' },
  ]);
});

test('MetadataDirectService.getTitleContent requires an account OMDb key', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');
  const service = new MetadataDirectService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getOmdbApiKeyForUser: async () => {
        throw new HttpError(404, 'Account secret not found.');
      },
    } as never,
    (async () => new Response('{}', { status: 200 })) as never,
  );

  service.resolveMetadataView = async function () {
    return {
      id: 'crisp:movie:55',
      mediaKey: 'movie:tmdb:55',
      mediaType: 'movie',
      kind: 'title',
      tmdbId: 55,
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
      title: 'Example Movie',
      subtitle: null,
      summary: null,
      overview: null,
      artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
      images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
      releaseDate: null,
      releaseYear: null,
      runtimeMinutes: null,
      rating: null,
      certification: null,
      status: null,
      genres: [],
      externalIds: { tmdb: 55, imdb: 'tt1234567', tvdb: null },
      seasonCount: null,
      episodeCount: null,
      nextEpisode: null,
    };
  };

  await assert.rejects(
    () => service.getTitleContent('user-1', 'crisp:movie:55'),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 412);
      assert.equal(error.message, 'OMDb is not configured for this account. Add an OMDb API key in Account Settings.');
      return true;
    },
  );
});
