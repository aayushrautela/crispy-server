import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MetadataCardView } from '../metadata/metadata-card.types.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';

function buildView(overrides: Partial<MetadataCardView>): MetadataCardView {
  const base = {
    mediaType: 'movie',
    kind: 'title',
    itemId: 'abc',
    parentMediaType: null,
    seriesItemId: null,
    seasonItemId: null,
    tmdbId: 694,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    title: 'Test Movie',
    subtitle: null,
    summary: null,
    overview: null,
    tagline: null,
    artwork: { poster: null, backdrop: null, logo: null, still: null },
    images: { poster: null, backdrop: null, logo: null, still: null },
    releaseDate: null,
    releaseYear: 2020,
    runtimeMinutes: 120,
    rating: 8,
    status: null,
    maturityRating: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    genres: [],
    externalIds: { tmdb: 694, tvdb: null, imdb: null },
  } as unknown as MetadataCardView;
  return { ...base, ...overrides };
}

test('watch card hydrator carries enriched imdb from card external ids', async (t) => {
  const { WatchCardHydrator } = await import('./watch-card-hydrator.service.js');
  const { MetadataCardService } = await import('../metadata/metadata-card.service.js');

  const view = buildView({ externalIds: { tmdb: 694, tvdb: null, imdb: 'tt1234567' } });
  const original = MetadataCardService.prototype.buildCardViews;
  MetadataCardService.prototype.buildCardViews = async () => [view] as never;
  t.after(() => {
    MetadataCardService.prototype.buildCardViews = original;
  });

  const hydrator = new WatchCardHydrator();
  const items = [
    { Id: 'abc', Type: 'Movie', Name: 'Test Movie', ProviderIds: { Tmdb: '694' } } as unknown as BaseItemDto,
  ];

  const cards = await hydrator.hydrateItems({} as never, items, null, true);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.providerIds?.imdb, 'tt1234567');
});

test('watch card hydrator falls back to raw ProviderIds when external ids are empty', async (t) => {
  const { WatchCardHydrator } = await import('./watch-card-hydrator.service.js');
  const { MetadataCardService } = await import('../metadata/metadata-card.service.js');

  const view = buildView({ externalIds: { tmdb: null, tvdb: null, imdb: null } });
  const original = MetadataCardService.prototype.buildCardViews;
  MetadataCardService.prototype.buildCardViews = async () => [view] as never;
  t.after(() => {
    MetadataCardService.prototype.buildCardViews = original;
  });

  const hydrator = new WatchCardHydrator();
  const items = [
    { Id: 'abc', Type: 'Movie', Name: 'Test Movie', ProviderIds: { Imdb: 'tt9999999' } } as unknown as BaseItemDto,
  ];

  const cards = await hydrator.hydrateItems({} as never, items, null, true);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.providerIds?.imdb, 'tt9999999');
});
