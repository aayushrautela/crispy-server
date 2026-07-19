import type { ListSource, ListSourceDescriptor } from './list-source.types.js';
import { TmdbDiscoverFilteredSource } from './sources/tmdb.discover-filtered.js';
import { TraktTrendingSource, TraktPopularSource, TraktPublicListSource } from './sources/trakt.sources.js';
import { HomeContinueWatchingSource } from './sources/home.continue-watching.js';
import { HomeRecentHistoryByGenreSource } from './sources/home.recent-history-by-genre.js';
import { HomePopularInRegionSource } from './sources/home.popular-in-region.js';

const sources: ListSource[] = [
  new TmdbDiscoverFilteredSource(),
  new TraktTrendingSource(),
  new TraktPopularSource(),
  new TraktPublicListSource(),
  new HomeContinueWatchingSource(),
  new HomeRecentHistoryByGenreSource(),
  new HomePopularInRegionSource(),
];

const registry = new Map<string, ListSource>();
for (const source of sources) {
  registry.set(source.descriptor().id, source);
}

export function listSourceDescriptors(): ListSourceDescriptor[] {
  return sources.map((source) => source.descriptor());
}

export function getListSource(id: string): ListSource | null {
  return registry.get(id) ?? null;
}

export function hasListSource(id: string): boolean {
  return registry.has(id);
}
