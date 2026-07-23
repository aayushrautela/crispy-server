import type { ListSource, ListSourceDescriptor } from './list-source.types.js';
import { TraktTrendingSource, TraktPopularSource, TraktAnticipatedSource, TraktNewReleasesSource, TraktCalendarSource, TraktPopularByRegionSource, TraktPublicListSource } from './sources/trakt.sources.js';

const sources: ListSource[] = [
  new TraktTrendingSource(),
  new TraktPopularSource(),
  new TraktAnticipatedSource(),
  new TraktNewReleasesSource(),
  new TraktCalendarSource(),
  new TraktPopularByRegionSource(),
  new TraktPublicListSource(),
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
