import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv({});

test('buildCardViewFromRow preserves tmdb linkage for tmdb-backed rows', async (t) => {
  const { MetadataCardService } = await import('./metadata-card.service.js');
  const { MetadataTitleSourceService } = await import('./metadata-title-source.service.js');

  const originals = {
    loadTitleSource: MetadataTitleSourceService.prototype.loadTitleSource,
  };

  t.after(() => {
    MetadataTitleSourceService.prototype.loadTitleSource = originals.loadTitleSource;
  });

  MetadataTitleSourceService.prototype.loadTitleSource = async function (_client, identity) {
    return {
      identity,
      language: null,
      tmdbTitle: {
        mediaType: 'show',
        tmdbId: 1399,
        name: 'TMDB Show',
        originalName: 'TMDB Show',
        overview: 'Overview',
        releaseDate: null,
        firstAirDate: '2024-01-01',
        status: 'Returning Series',
        posterPath: '/poster.jpg',
        backdropPath: '/backdrop.jpg',
        runtime: null,
        episodeRunTime: [45],
        numberOfSeasons: 8,
        numberOfEpisodes: 73,
        externalIds: { imdb_id: 'tt0944947', tvdb_id: 121361 },
        raw: {
          genres: [],
          videos: { results: [] },
          credits: { cast: [], crew: [] },
          created_by: [],
          reviews: { results: [] },
          production_companies: [],
          networks: [],
          production_countries: [],
          spoken_languages: [],
          similar: { results: [] },
        },
        fetchedAt: '2026-03-22T00:00:00.000Z',
        expiresAt: '2026-03-23T00:00:00.000Z',
      },
      tmdbCurrentEpisode: null,
      tmdbNextEpisode: null,
    } as never;
  };

  const service = new MetadataCardService();
  const view = await service.buildCardViewFromRow({} as never, {
    media_key: 'show:tmdb:1399',
    media_type: 'show',
    tmdb_id: 1399,
    title: null,
    subtitle: null,
    poster_url: null,
    backdrop_url: null,
  });

  assert.equal(view.provider, 'tmdb');
  assert.equal(view.providerId, '1399');
  assert.equal(view.tmdbId, 1399);
  assert.equal(view.title, 'TMDB Show');
});
