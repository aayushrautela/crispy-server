import type { DbClient } from '../../../lib/db.js';
import type { SectionProvider, SectionProviderContext } from '../homescreen.types.js';
import { TmdbSectionBuilder, type TmdbSectionBuilderOptions } from './tmdb-section-builder.js';

function providerFor(opts: TmdbSectionBuilderOptions): SectionProvider {
  const builder = new TmdbSectionBuilder();
  return {
    key: opts.key,
    async build(ctx: SectionProviderContext, client: DbClient) {
      return builder.build(opts, ctx, client);
    },
  };
}

export const tmdbTrendingHeroProvider: SectionProvider = providerFor({
  key: 'tmdb-trending-hero',
  title: 'Trending',
  subtitle: 'What everyone is watching right now',
  sectionType: 'heroCarousel',
  maxItems: 8,
  path: '/trending/all/day',
});

export const tmdbTrendingMoviesProvider: SectionProvider = providerFor({
  key: 'tmdb-trending-movies',
  title: 'Trending Movies',
  sectionType: 'contentRail',
  maxItems: 20,
  path: '/trending/movie/week',
});

export const tmdbPopularMoviesProvider: SectionProvider = providerFor({
  key: 'tmdb-popular-movies',
  title: 'Popular Movies',
  sectionType: 'contentRail',
  maxItems: 20,
  path: '/movie/popular',
});

export const tmdbPopularTvProvider: SectionProvider = providerFor({
  key: 'tmdb-popular-tv',
  title: 'Popular Series',
  sectionType: 'contentRail',
  maxItems: 20,
  path: '/tv/popular',
});

export const tmdbTopRatedMoviesProvider: SectionProvider = providerFor({
  key: 'tmdb-top-rated-movies',
  title: 'Top Rated Movies',
  sectionType: 'contentRail',
  maxItems: 20,
  path: '/movie/top_rated',
});

export const tmdbTopRatedTvProvider: SectionProvider = providerFor({
  key: 'tmdb-top-rated-tv',
  title: 'Top Rated Series',
  sectionType: 'contentRail',
  maxItems: 20,
  path: '/tv/top_rated',
});

export const tmdbNewReleasesProvider: SectionProvider = providerFor({
  key: 'tmdb-new-releases',
  title: 'New Releases',
  subtitle: 'Fresh this week',
  sectionType: 'contentRail',
  maxItems: 20,
  path: '/discover/movie',
  query: {
    sort_by: 'primary_release_date.desc',
    'primary_release_date.gte': new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    'primary_release_date.lte': new Date().toISOString().slice(0, 10),
    include_adult: 'false',
  },
});

export const tmdbRegionTopProvider: SectionProvider = providerFor({
  key: 'tmdb-region-top',
  title: 'Popular in Your Region',
  sectionType: 'contentRail',
  maxItems: 20,
  path: '/movie/popular',
});
