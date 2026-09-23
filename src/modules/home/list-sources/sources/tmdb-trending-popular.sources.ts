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
      const raw = await this.tmdb.request(`/trending/${mediaType}/${timeWindow}`, { language, page: 1 });
      results = (raw.results ?? []) as Array<Record<string, unknown>>;
    } catch (err) {
      console.error(`tmdb.trending failed for ${mediaType}/${timeWindow}:`, err);
      return { items: [] };
    }

    const items = results
      .map((r) => ({ id: asNumber(r.id) }))
      .filter((r) => r.id > 0)
      .slice(0, limit)
      .map((r) => toLite(mediaType, r.id));

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
      const raw = await this.tmdb.request(path, { language, page: 1 });
      results = (raw.results ?? []) as Array<Record<string, unknown>>;
    } catch (err) {
      console.error(`tmdb.popular failed for ${mediaType}:`, err);
      return { items: [] };
    }

    const items = results
      .map((r) => ({ id: asNumber(r.id) }))
      .filter((r) => r.id > 0)
      .slice(0, limit)
      .map((r) => toLite(mediaType, r.id));

    if (items.length === 0) return { items: [] };

    return {
      items,
      meta: { sourceCount: items.length },
    };
  }
}