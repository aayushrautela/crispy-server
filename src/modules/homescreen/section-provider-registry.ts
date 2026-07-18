import type { SectionProvider } from './homescreen.types.js';
import {
  tmdbNewReleasesProvider,
  tmdbPopularMoviesProvider,
  tmdbPopularTvProvider,
  tmdbRegionTopProvider,
  tmdbTopRatedMoviesProvider,
  tmdbTopRatedTvProvider,
  tmdbTrendingHeroProvider,
  tmdbTrendingMoviesProvider,
} from './providers/tmdb-initial.providers.js';
import { tmdbGenreRailsProvider } from './providers/tmdb-genre-rails.provider.js';
import { collectionsProvider } from './providers/collections.provider.js';
import { traktListsProvider } from './providers/trakt-lists.provider.js';

/**
 * Authoritative registry of every homescreen section provider, keyed by the
 * section key used in templates. Adding a new rail = add a provider file and
 * register it here. The builder never imports concrete providers directly.
 */
export function buildSectionProviders(): Map<string, SectionProvider> {
  const providers: SectionProvider[] = [
    tmdbTrendingHeroProvider,
    tmdbTrendingMoviesProvider,
    tmdbPopularMoviesProvider,
    tmdbPopularTvProvider,
    tmdbTopRatedMoviesProvider,
    tmdbTopRatedTvProvider,
    tmdbNewReleasesProvider,
    tmdbRegionTopProvider,
    tmdbGenreRailsProvider,
    collectionsProvider,
    traktListsProvider,
  ];

  const map = new Map<string, SectionProvider>();
  for (const provider of providers) {
    map.set(provider.key, provider);
  }
  return map;
}
