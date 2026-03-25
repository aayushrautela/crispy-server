import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../../lib/errors.js';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

seedTestEnv();

const passthroughTransaction = async <T>(work: (client: never) => Promise<T>): Promise<T> => work({} as never);

test('MetadataDirectService.getTitleContent resolves OMDb content for a title', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');
  let requestedUrl = '';
  let cachedImdbId: string | null = null;
  const service = new MetadataDirectService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      listOmdbApiKeysForLookup: async (userId: string) => ({
        ownKeys: ['omdb-test-key'],
        pooledKeys: [],
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
    {
      findByImdbId: async () => null,
      upsert: async (_client: unknown, _imdbId: string, payload: { imdbId?: string }) => {
        cachedImdbId = payload.imdbId ?? null;
        return payload;
      },
    } as never,
    passthroughTransaction,
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
  assert.equal(cachedImdbId, 'tt1234567');
  assert.deepEqual(result.omdb.ratings, [
    { source: 'Internet Movie Database', value: '8.7/10' },
    { source: 'Rotten Tomatoes', value: '95%' },
  ]);
});

test('MetadataDirectService.getTitleContent requires an account OMDb key', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');
  const previousServerKeys = process.env.OMDB_API_KEYS;
  process.env.OMDB_API_KEYS = '';
  const service = new MetadataDirectService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      listOmdbApiKeysForLookup: async () => ({ ownKeys: [], pooledKeys: [] }),
    } as never,
    (async () => new Response('{}', { status: 200 })) as never,
    {
      findByImdbId: async () => null,
      upsert: async (_client: unknown, _imdbId: string, payload: Record<string, unknown>) => payload,
    } as never,
    passthroughTransaction,
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
      assert.equal(error.message, 'OMDb is not configured. Add an OMDb API key in Account Settings or configure server OMDb keys.');
      return true;
    },
  );

  if (previousServerKeys === undefined) {
    delete process.env.OMDB_API_KEYS;
  } else {
    process.env.OMDB_API_KEYS = previousServerKeys;
  }
});

test('MetadataDirectService.getTitleContent falls back from a limited user key to a server key', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');
  const previousServerKeys = process.env.OMDB_API_KEYS;
  process.env.OMDB_API_KEYS = 'server-key-a,server-key-b';

  const requestedKeys: string[] = [];
  const service = new MetadataDirectService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      listOmdbApiKeysForLookup: async () => ({
        ownKeys: ['user-key'],
        pooledKeys: ['pooled-key'],
      }),
    } as never,
    (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const apiKey = url.searchParams.get('apikey') ?? '';
      requestedKeys.push(apiKey);

      if (apiKey === 'user-key') {
        return new Response(JSON.stringify({
          Response: 'False',
          Error: 'Request limit reached!',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        Response: 'True',
        imdbID: 'tt1234567',
        Title: 'Example Movie',
        Type: 'movie',
        Genre: 'Drama',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as never,
    {
      findByImdbId: async () => null,
      upsert: async (_client: unknown, _imdbId: string, payload: Record<string, unknown>) => payload,
    } as never,
    passthroughTransaction,
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

  assert.equal(result.omdb.imdbId, 'tt1234567');
  assert.equal(requestedKeys[0], 'user-key');
  assert.ok(['server-key-a', 'server-key-b'].includes(requestedKeys[1] ?? ''));
  assert.equal(requestedKeys.includes('pooled-key'), false);

  if (previousServerKeys === undefined) {
    delete process.env.OMDB_API_KEYS;
  } else {
    process.env.OMDB_API_KEYS = previousServerKeys;
  }
});

test('MetadataDirectService.getTitleContent returns cached OMDb content before looking up keys', async () => {
  const { MetadataDirectService } = await import('./metadata-direct.service.js');
  let lookupCalled = false;
  let fetchCalled = false;
  const service = new MetadataDirectService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      listOmdbApiKeysForLookup: async () => {
        lookupCalled = true;
        return { ownKeys: ['user-key'], pooledKeys: [] };
      },
    } as never,
    (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as never,
    {
      findByImdbId: async () => ({
        imdbId: 'tt1234567',
        title: 'Cached Movie',
        type: 'movie',
        year: null,
        rated: null,
        released: null,
        runtime: null,
        genres: [],
        directors: [],
        writers: [],
        actors: [],
        plot: null,
        languages: [],
        countries: [],
        awards: null,
        posterUrl: null,
        ratings: [],
        imdbRating: null,
        imdbVotes: null,
        metascore: null,
        boxOffice: null,
        production: null,
        website: null,
        totalSeasons: null,
      }),
      upsert: async (_client: unknown, _imdbId: string, payload: Record<string, unknown>) => payload,
    } as never,
    passthroughTransaction,
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

  assert.equal(result.omdb.title, 'Cached Movie');
  assert.equal(lookupCalled, false);
  assert.equal(fetchCalled, false);
});
