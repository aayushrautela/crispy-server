import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv({});

test('buildCardViewFromRow preserves tmdb linkage for provider-backed rows', async (t) => {
  const { MetadataCardService } = await import('./metadata-card.service.js');
  const { ProviderMetadataService } = await import('./provider-metadata.service.js');
  const { TmdbCacheService } = await import('./providers/tmdb-cache.service.js');

  const originals = {
    loadIdentityContext: ProviderMetadataService.prototype.loadIdentityContext,
    getTitle: TmdbCacheService.prototype.getTitle,
    getEpisode: TmdbCacheService.prototype.getEpisode,
  };

  t.after(() => {
    ProviderMetadataService.prototype.loadIdentityContext = originals.loadIdentityContext;
    TmdbCacheService.prototype.getTitle = originals.getTitle;
    TmdbCacheService.prototype.getEpisode = originals.getEpisode;
  });

  ProviderMetadataService.prototype.loadIdentityContext = async function (_client, identity) {
    return {
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
      similar: [],
    } as never;
  };
  TmdbCacheService.prototype.getTitle = async function () {
    throw new Error('tmdb lookup should not run for provider-backed row hydration');
  };
  TmdbCacheService.prototype.getEpisode = async function () {
    throw new Error('tmdb episode lookup should not run for provider-backed row hydration');
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
