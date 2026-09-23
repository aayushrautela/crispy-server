import type { HomeWriteItemLite, ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult, ListSourceProvider } from '../list-source.types.js';
import { limitFromCtx } from './helpers.js';
import { TmdbClient } from '../../../metadata/providers/tmdb.client.js';

type MediaType = 'movie' | 'tv';

function toLite(type: MediaType, tmdbId: number): HomeWriteItemLite {
  const ref: { provider: ListSourceProvider; providerId: string } = { provider: 'tmdb', providerId: String(tmdbId) };
  return { type, providerRefs: [ref] };
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// TMDB returns up to 20 records per page on standard endpoints (trending,
// popular) and offers no page_size parameter. Page sequentially until we have
// `limit` titles, deduping ids across pages and tolerating a mid-stream page
// failure once items are already collected.
const TMDB_PAGE_SIZE = 20;
const TMDB_MAX_PAGES = 5;

async function collectTmdbItems(
  tmdb: TmdbClient,
  path: string,
  query: Record<string, unknown>,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const collected: Array<Record<string, unknown>> = [];
  const seen = new Set<number>();
  const pages = Math.min(TMDB_MAX_PAGES, Math.max(1, Math.ceil(limit / TMDB_PAGE_SIZE)));

  for (let page = 1; page <= pages; page++) {
    let raw: Record<string, unknown>;
    try {
      raw = await tmdb.request(path, { ...query, page });
    } catch (err) {
      if (collected.length === 0) throw err;
      break;
    }
    const rawResults = raw?.results;
    if (!Array.isArray(rawResults)) break;
    const results = rawResults as Array<Record<string, unknown>>;
    for (const r of results) {
      const id = asNumber(r.id);
      if (id > 0 && !seen.has(id)) {
        seen.add(id);
        collected.push(r);
      }
    }
    if (collected.length >= limit) break;
    const totalPages = asNumber(raw.total_pages);
    if (totalPages > 0 && page >= totalPages) break;
    if (results.length === 0) break;
  }
  return collected.slice(0, limit);
}

// --- Trending (weekly view velocity) ---

type TrendingConfig = { mediaType?: MediaType; timeWindow?: 'day' | 'week'; limit?: number };

export class TmdbTrendingSource implements ListSource<TrendingConfig> {
  constructor(private readonly tmdb = new TmdbClient()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.trending',
      name: 'TMDB Trending',
      description: 'Titles with the fastest rising interest on TMDB (trending window, daily or weekly).',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'tmdb',
      configFields: [
        {
          key: 'mediaType',
          label: 'Media type',
          type: 'select',
          required: true,
          default: 'movie',
          options: [
            { value: 'movie', label: 'Movies' },
            { value: 'tv', label: 'TV' },
          ],
        },
        {
          key: 'timeWindow',
          label: 'Trending window',
          type: 'select',
          required: false,
          default: 'week',
          options: [
            { value: 'day', label: 'Today' },
            { value: 'week', label: 'This week' },
          ],
        },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'trending-movie', label: 'Trending Movies', sourceConfig: { mediaType: 'movie', timeWindow: 'week' } },
        { id: 'trending-show', label: 'Trending Shows', sourceConfig: { mediaType: 'tv', timeWindow: 'week' } },
      ],
    };
  }

  suggestListKey(config: TrendingConfig): string {
    return `tmdb-trending-${config.mediaType ?? 'movie'}`;
  }

  async fetchItems(config: TrendingConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const language = ctx.tmdbLanguage ?? 'en';
    const mediaType = config.mediaType === 'tv' ? 'tv' : 'movie';
    const timeWindow = config.timeWindow === 'day' ? 'day' : 'week';
    const limit = limitFromCtx(ctx, config.limit ?? 40);

    let results: Array<Record<string, unknown>> = [];
    try {
      const path = `/trending/${mediaType}/${timeWindow}`;
      results = await collectTmdbItems(this.tmdb, path, { language }, limit);
    } catch (err) {
      console.error(`tmdb.trending failed for ${mediaType}/${timeWindow}:`, err);
      return { items: [] };
    }

    const items = results.map((r) => toLite(mediaType, asNumber(r.id)));

    if (items.length === 0) return { items: [] };

    return {
      items,
      meta: { sourceCount: items.length },
    };
  }
}

// --- Popular (recency-weighted popularity, refreshed daily) ---

type PopularConfig = { mediaType?: MediaType; limit?: number };

export class TmdbPopularSource implements ListSource<PopularConfig> {
  constructor(private readonly tmdb = new TmdbClient()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.popular',
      name: 'TMDB Popular',
      description: 'The most popular titles on TMDB right now.',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'tmdb',
      configFields: [
        {
          key: 'mediaType',
          label: 'Media type',
          type: 'select',
          required: true,
          default: 'movie',
          options: [
            { value: 'movie', label: 'Movies' },
            { value: 'tv', label: 'TV' },
          ],
        },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'popular-movie', label: 'Popular Movies', sourceConfig: { mediaType: 'movie' } },
        { id: 'popular-show', label: 'Popular Shows', sourceConfig: { mediaType: 'tv' } },
      ],
    };
  }

  suggestListKey(config: PopularConfig): string {
    return `tmdb-popular-${config.mediaType ?? 'movie'}`;
  }

  async fetchItems(config: PopularConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const language = ctx.tmdbLanguage ?? 'en';
    const mediaType = config.mediaType === 'tv' ? 'tv' : 'movie';
    const limit = limitFromCtx(ctx, config.limit ?? 40);

    let results: Array<Record<string, unknown>> = [];
    try {
      const path = mediaType === 'tv' ? '/tv/popular' : '/movie/popular';
      results = await collectTmdbItems(this.tmdb, path, { language }, limit);
    } catch (err) {
      console.error(`tmdb.popular failed for ${mediaType}:`, err);
      return { items: [] };
    }

    const items = results.map((r) => toLite(mediaType, asNumber(r.id)));

    if (items.length === 0) return { items: [] };

    return {
      items,
      meta: { sourceCount: items.length },
    };
  }
}