import type { ListSource, ListSourceDescriptor } from './list-source.types.js';
import { TmdbTrendingSource, TmdbPopularSource } from './sources/tmdb-trending-popular.sources.js';
import { TmdbTrendingPersonSource, TmdbNewThisWeekSource, TmdbGenreFreshSource } from './sources/tmdb-pills.sources.js';
import { MdbListPublicListSource } from './sources/mdblist.sources.js';

const sources: ListSource[] = [
  new TmdbTrendingSource(),
  new TmdbPopularSource(),
  new TmdbTrendingPersonSource(),
  new TmdbNewThisWeekSource(),
  new TmdbGenreFreshSource(),
  new MdbListPublicListSource(),
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