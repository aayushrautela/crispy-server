import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv({});

test('buildCardViewFromRow preserves tmdb linkage for provider-backed rows', async (t) => {
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
      providerIdentity: identity,
      providerContext: {
        title: {
          mediaType: 'show',
          provider: 'tvdb',
          providerId: identity.providerId ?? '121361',
          title: 'Provider Show',
          originalTitle: 'Provider Show',
          summary: 'Summary',
          overview: 'Overview',
          releaseDate: '2024-01-01',
          status: 'Continuing',
          posterUrl: 'https://img.example/poster.jpg',
          backdropUrl: 'https://img.example/backdrop.jpg',
          logoUrl: null,
          runtimeMinutes: 45,
          rating: 8.7,
          certification: null,
          genres: ['Drama'],
          externalIds: { tmdb: 1399, imdb: 'tt0944947', tvdb: 121361, kitsu: null },
          seasonCount: 8,
          episodeCount: 73,
          raw: {},
        },
        currentEpisode: null,
        nextEpisode: null,
        seasons: [],
        episodes: [],
        videos: [],
        cast: [],
        directors: [],
        creators: [],
        reviews: [],
        production: null,
        collection: null,
        collectionItems: [],
        similar: [],
      },
      tmdbTitle: null,
      tmdbCurrentEpisode: null,
      tmdbNextEpisode: null,
    } as never;
  };

  const service = new MetadataCardService();
  const view = await service.buildCardViewFromRow({} as never, {
    media_key: 'show:tvdb:121361',
    media_type: 'show',
    tmdb_id: 1399,
    title: null,
    subtitle: null,
    poster_url: null,
    backdrop_url: null,
  });

  assert.equal(view.provider, 'tvdb');
  assert.equal(view.providerId, '121361');
  assert.equal(view.tmdbId, 1399);
  assert.equal(view.title, 'Provider Show');
});
