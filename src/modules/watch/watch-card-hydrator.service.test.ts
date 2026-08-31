import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MetadataCardView } from '../metadata/metadata-card.types.js';

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
    artwork: { artwork: null, still: null },
    images: { artwork: null, logo: null, still: null },
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
  const { ContentIdentityService } = await import('../identity/content-identity.service.js');

  const view = buildView({ externalIds: { tmdb: 694, tvdb: null, imdb: 'tt1234567' } });
  const origBuild = MetadataCardService.prototype.buildCardViewsForIdentities;
  const origResolve = ContentIdentityService.prototype.resolveMediaIdentitiesBatched;
  MetadataCardService.prototype.buildCardViewsForIdentities = async () => [view] as never;
  ContentIdentityService.prototype.resolveMediaIdentitiesBatched = async () =>
    new Map([['00000000-0000-4000-a000-000000000001', { mediaKey: 'movie:tmdb:694', mediaType: 'movie', provider: 'tmdb', providerId: '694', tmdbId: 694, contentId: '00000000-0000-4000-a000-000000000001' } as never]]) as never;
  t.after(() => {
    MetadataCardService.prototype.buildCardViewsForIdentities = origBuild;
    ContentIdentityService.prototype.resolveMediaIdentitiesBatched = origResolve;
  });

  const hydrator = new WatchCardHydrator();
  const refs = [
    { itemId: '0000000000004000a000000000000001', mediaType: 'movie' as const, progress: null },
  ];

  const cards = await hydrator.hydrateByIds({} as never, refs, null);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.providerIds?.imdb, 'tt1234567');
});

test('watch card hydrator hydrates via last-layer (ClientMediaCard)', async (t) => {
  const { WatchCardHydrator } = await import('./watch-card-hydrator.service.js');
  const { MetadataCardService } = await import('../metadata/metadata-card.service.js');
  const { ContentIdentityService } = await import('../identity/content-identity.service.js');

  const view = buildView({ externalIds: { tmdb: 694, tvdb: null, imdb: 'tt9999999' } });
  const origBuild = MetadataCardService.prototype.buildCardViewsForIdentities;
  const origResolve = ContentIdentityService.prototype.resolveMediaIdentitiesBatched;
  MetadataCardService.prototype.buildCardViewsForIdentities = async () => [view] as never;
  ContentIdentityService.prototype.resolveMediaIdentitiesBatched = async () =>
    new Map([['00000000-0000-4000-a000-000000000001', { mediaKey: 'movie:tmdb:694', mediaType: 'movie', provider: 'tmdb', providerId: '694', tmdbId: 694, contentId: '00000000-0000-4000-a000-000000000001' } as never]]) as never;
  t.after(() => {
    MetadataCardService.prototype.buildCardViewsForIdentities = origBuild;
    ContentIdentityService.prototype.resolveMediaIdentitiesBatched = origResolve;
  });

  const hydrator = new WatchCardHydrator();
  const refs = [
    { itemId: '0000000000004000a000000000000001', mediaType: 'movie' as const, progress: null },
  ];

  const cards = await hydrator.hydrateByIds({} as never, refs, null);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.itemId, '0000000000004000a000000000000001');
});
