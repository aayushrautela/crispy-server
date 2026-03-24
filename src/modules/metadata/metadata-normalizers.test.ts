import test from 'node:test';
import assert from 'node:assert/strict';

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

async function loadModule() {
  seedTestEnv();
  return import('./metadata-normalizers.js');
}

test('buildImageUrl returns null for null path', async () => {
  const { buildImageUrl } = await loadModule();
  assert.equal(buildImageUrl(null, 'w500'), null);
});

test('buildImageUrl constructs full TMDB URL', async () => {
  const { buildImageUrl } = await loadModule();
  assert.equal(buildImageUrl('/poster.jpg', 'w500'), 'https://image.tmdb.org/t/p/w500/poster.jpg');
});

test('buildMetadataId for movie', async () => {
  const { buildMetadataId } = await loadModule();
  assert.equal(buildMetadataId({ mediaType: 'movie', tmdbId: 123 }), 'crisp:movie:123');
});

test('buildMetadataId for show', async () => {
  const { buildMetadataId } = await loadModule();
  assert.equal(buildMetadataId({ mediaType: 'show', tmdbId: 456 }), 'crisp:show:456');
});

test('buildMetadataId for episode', async () => {
  const { buildMetadataId } = await loadModule();
  assert.equal(
    buildMetadataId({ mediaType: 'episode', showTmdbId: 42, seasonNumber: 1, episodeNumber: 3 }),
    'crisp:episode:42:1:3',
  );
});

test('buildMetadataId throws for invalid inputs', async () => {
  const { buildMetadataId } = await loadModule();
  assert.throws(() => buildMetadataId({ mediaType: 'movie', tmdbId: null }), { statusCode: 400 });
  assert.throws(() => buildMetadataId({ mediaType: 'episode', showTmdbId: 42, seasonNumber: null, episodeNumber: 3 }), { statusCode: 400 });
});

test('parseMetadataId for movie id', async () => {
  const { parseMetadataId } = await loadModule();
  const result = parseMetadataId('crisp:movie:789');
  assert.equal(result.mediaType, 'movie');
  assert.equal(result.tmdbId, 789);
  assert.equal(result.mediaKey, 'movie:tmdb:789');
});

test('parseMetadataId for show id', async () => {
  const { parseMetadataId } = await loadModule();
  const result = parseMetadataId('crisp:show:42');
  assert.equal(result.mediaType, 'show');
  assert.equal(result.tmdbId, 42);
  assert.equal(result.mediaKey, 'show:tmdb:42');
});

test('parseMetadataId for episode id', async () => {
  const { parseMetadataId } = await loadModule();
  const result = parseMetadataId('crisp:episode:42:1:3');
  assert.equal(result.mediaType, 'episode');
  assert.equal(result.tmdbId, null);
  assert.equal(result.showTmdbId, 42);
  assert.equal(result.seasonNumber, 1);
  assert.equal(result.episodeNumber, 3);
});

test('parseMetadataId rejects invalid ids', async () => {
  const { parseMetadataId } = await loadModule();
  assert.throws(() => parseMetadataId('tmdb:movie:123'), { statusCode: 400 });
  assert.throws(() => parseMetadataId('crisp:movie:not-a-number'), { statusCode: 400 });
  assert.throws(() => parseMetadataId('crisp:episode:1:2'), { statusCode: 400 });
});

test('buildMetadataView for show extracts all fields', async () => {
  const { buildMetadataView } = await loadModule();

  const title = {
    mediaType: 'tv' as const,
    tmdbId: 42,
    name: 'Breaking Point',
    originalName: 'Breaking Point',
    overview: 'A thrilling drama.',
    releaseDate: null,
    firstAirDate: '2024-01-01',
    status: 'Returning Series',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: null,
    episodeRunTime: [45, 42] as number[],
    numberOfSeasons: 3,
    numberOfEpisodes: 30,
    externalIds: { imdb_id: 'tt1234567', tvdb_id: 98765 },
    raw: {
      genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
      vote_average: 8.4,
      images: { logos: [{ file_path: '/logo.png', iso_639_1: 'en' }] },
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
      seasons: [
        { season_number: 0, name: 'Specials', poster_path: '/season0.jpg' },
        { season_number: 1, name: 'Season 1', episode_count: 10, air_date: '2024-01-01', overview: 'S1 overview', poster_path: '/season1.jpg' },
      ],
    },
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const view = buildMetadataView({
    identity: { mediaKey: 'show:tmdb:42', mediaType: 'show', tmdbId: 42, showTmdbId: 42, seasonNumber: null, episodeNumber: null },
    title,
  });

  assert.equal(view.id, 'crisp:show:42');
  assert.equal(view.mediaType, 'show');
  assert.equal(view.kind, 'title');
  assert.equal(view.title, 'Breaking Point');
  assert.equal(view.overview, 'A thrilling drama.');
  assert.equal(view.artwork.posterUrl, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.equal(view.artwork.backdropUrl, 'https://image.tmdb.org/t/p/w780/backdrop.jpg');
  assert.equal(view.images.logoUrl, 'https://image.tmdb.org/t/p/w500/logo.png');
  assert.equal(view.rating, 8.4);
  assert.deepEqual(view.genres, ['Drama', 'Crime']);
  assert.equal(view.certification, 'TV-MA');
  assert.equal(view.seasonCount, 3);
  assert.equal(view.episodeCount, 30);
  assert.equal(view.externalIds.imdb, 'tt1234567');
  assert.equal(view.externalIds.tvdb, 98765);
});

test('buildMetadataView for movie extracts year from releaseDate', async () => {
  const { buildMetadataView } = await loadModule();

  const title = {
    mediaType: 'movie' as const,
    tmdbId: 100,
    name: 'Test Movie',
    originalName: 'Test Movie',
    overview: 'A test movie.',
    releaseDate: '2025-06-15',
    firstAirDate: null,
    status: 'Released',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: 130,
    episodeRunTime: [] as number[],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    raw: {
      genres: [],
      vote_average: 7.0,
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] },
    },
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const view = buildMetadataView({
    identity: { mediaKey: 'movie:tmdb:100', mediaType: 'movie', tmdbId: 100, showTmdbId: null, seasonNumber: null, episodeNumber: null },
    title,
  });

  assert.equal(view.id, 'crisp:movie:100');
  assert.equal(view.releaseDate, '2025-06-15');
  assert.equal(view.releaseYear, 2025);
  assert.equal(view.runtimeMinutes, 130);
  assert.equal(view.certification, 'PG-13');
});

test('buildMetadataView for episode resolves current and next episode', async () => {
  const { buildMetadataView } = await loadModule();

  const title = {
    mediaType: 'tv' as const,
    tmdbId: 42,
    name: 'Breaking Point',
    originalName: 'Breaking Point',
    overview: 'A thrilling drama.',
    releaseDate: null,
    firstAirDate: '2024-01-01',
    status: 'Returning Series',
    posterPath: '/poster.jpg',
    backdropPath: '/backdrop.jpg',
    runtime: null,
    episodeRunTime: [45] as number[],
    numberOfSeasons: 3,
    numberOfEpisodes: 30,
    externalIds: {},
    raw: { genres: [], vote_average: 8.0 },
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const currentEpisode = {
    showTmdbId: 42,
    seasonNumber: 1,
    episodeNumber: 2,
    tmdbId: 554,
    name: 'Previous Episode',
    overview: 'Previous.',
    airDate: '2024-01-08',
    runtime: 45,
    stillPath: '/prev.jpg',
    voteAverage: 7.8,
    raw: {},
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const nextEpisode = {
    showTmdbId: 42,
    seasonNumber: 1,
    episodeNumber: 3,
    tmdbId: 555,
    name: 'The Betrayal',
    overview: 'Things go wrong.',
    airDate: '2024-01-15',
    runtime: 47,
    stillPath: '/still.jpg',
    voteAverage: 8.1,
    raw: {},
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const view = buildMetadataView({
    identity: { mediaKey: 'episode:tmdb:42:1:2', mediaType: 'episode', tmdbId: null, showTmdbId: 42, seasonNumber: 1, episodeNumber: 2 },
    title,
    currentEpisode,
    nextEpisode,
  });

  assert.equal(view.id, 'crisp:episode:42:1:2');
  assert.equal(view.mediaType, 'episode');
  assert.equal(view.kind, 'episode');
  assert.equal(view.subtitle, 'S01 E02');
  assert.equal(view.title, 'Previous Episode');
  assert.equal(view.summary, 'Previous.');
  assert.equal(view.nextEpisode?.id, 'crisp:episode:42:1:3');
  assert.equal(view.nextEpisode?.title, 'The Betrayal');
});

test('buildEpisodePreview produces clean payload', async () => {
  const { buildEpisodePreview } = await loadModule();

  const title = {
    mediaType: 'tv' as const,
    tmdbId: 42,
    name: 'Test Show',
    originalName: 'Test Show',
    overview: null,
    releaseDate: null,
    firstAirDate: null,
    status: null,
    posterPath: '/poster.jpg',
    backdropPath: null,
    runtime: null,
    episodeRunTime: [] as number[],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    raw: {},
    fetchedAt: '',
    expiresAt: '',
  };

  const episode = {
    showTmdbId: 42,
    seasonNumber: 1,
    episodeNumber: 3,
    tmdbId: 555,
    name: 'Episode 3',
    overview: 'Overview.',
    airDate: '2024-01-15',
    runtime: 47,
    stillPath: '/still.jpg',
    voteAverage: 8.1,
    raw: {},
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const preview = buildEpisodePreview(title, episode);

  assert.equal(preview.mediaType, 'episode');
  assert.equal(preview.showTmdbId, 42);
  assert.equal(preview.seasonNumber, 1);
  assert.equal(preview.episodeNumber, 3);
  assert.equal(preview.airDate, '2024-01-15');
  assert.equal(preview.runtimeMinutes, 47);
  assert.equal(preview.rating, 8.1);
  assert.equal(preview.images.stillUrl, 'https://image.tmdb.org/t/p/w500/still.jpg');
});

test('buildSeasonViewFromTitleRaw extracts seasons from raw payload', async () => {
  const { buildSeasonViewFromTitleRaw } = await loadModule();

  const title = {
    mediaType: 'tv' as const,
    tmdbId: 42,
    name: 'Test Show',
    originalName: 'Test Show',
    overview: null,
    releaseDate: null,
    firstAirDate: null,
    status: null,
    posterPath: null,
    backdropPath: null,
    runtime: null,
    episodeRunTime: [] as number[],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: {},
    raw: {
      seasons: [
        { season_number: 0, name: 'Specials', poster_path: '/season0.jpg' },
        { season_number: 1, name: 'Season 1', episode_count: 10, air_date: '2024-01-01', overview: 'S1 overview', poster_path: '/season1.jpg' },
      ],
    },
    fetchedAt: '',
    expiresAt: '',
  };

  const seasons = buildSeasonViewFromTitleRaw(title);

  assert.equal(seasons.length, 2);
  assert.equal(seasons[0]?.seasonNumber, 0);
  assert.equal(seasons[0]?.title, 'Specials');
  assert.equal(seasons[1]?.seasonNumber, 1);
  assert.equal(seasons[1]?.title, 'Season 1');
  assert.equal(seasons[1]?.episodeCount, 10);
  assert.equal(seasons[1]?.images.posterUrl, 'https://image.tmdb.org/t/p/w500/season1.jpg');
});

test('buildSeasonViewFromRecord produces clean payload', async () => {
  const { buildSeasonViewFromRecord } = await loadModule();

  const record = {
    showTmdbId: 42,
    seasonNumber: 2,
    name: 'Season 2',
    overview: 'The second season.',
    airDate: '2025-01-01',
    posterPath: '/season2.jpg',
    episodeCount: 8,
    raw: {},
    fetchedAt: '2026-03-22T00:00:00.000Z',
    expiresAt: '2026-03-23T00:00:00.000Z',
  };

  const view = buildSeasonViewFromRecord(42, record);

  assert.equal(view.id, 'crisp:season:42:2');
  assert.equal(view.showId, 'crisp:show:42');
  assert.equal(view.title, 'Season 2');
  assert.equal(view.episodeCount, 8);
  assert.equal(view.images.posterUrl, 'https://image.tmdb.org/t/p/w500/season2.jpg');
});

test('buildEpisodeView includes show context', async () => {
  const { buildEpisodeView } = await loadModule();

  const title = {
    mediaType: 'tv' as const,
    tmdbId: 42,
    name: 'Breaking Point',
    originalName: 'Breaking Point',
    overview: null,
    releaseDate: null,
    firstAirDate: null,
    status: null,
    posterPath: '/poster.jpg',
    backdropPath: null,
    runtime: null,
    episodeRunTime: [] as number[],
    numberOfSeasons: null,
    numberOfEpisodes: null,
    externalIds: { imdb_id: 'tt1234567' },
    raw: {},
    fetchedAt: '',
    expiresAt: '',
  };

  const episode = {
    showTmdbId: 42,
    seasonNumber: 1,
    episodeNumber: 3,
    tmdbId: 555,
    name: 'Episode 3',
    overview: null,
    airDate: null,
    runtime: null,
    stillPath: null,
    voteAverage: null,
    raw: {},
    fetchedAt: '',
    expiresAt: '',
  };

  const view = buildEpisodeView(title, episode);

  assert.equal(view.showId, 'crisp:show:42');
  assert.equal(view.showTitle, 'Breaking Point');
  assert.equal(view.showExternalIds.imdb, 'tt1234567');
});
