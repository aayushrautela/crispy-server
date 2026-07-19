import { TmdbCacheService } from '../../../metadata/providers/tmdb-cache.service.js';
import type { ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult } from '../list-source.types.js';
import { limitFromCtx, resultFromRecords } from './tmdb-helpers.js';

type TrendingConfig = { mediaType: 'movie' | 'tv'; timeWindow?: 'day' | 'week'; limit?: number };

export class TmdbTrendingSource implements ListSource<TrendingConfig> {
  constructor(private readonly tmdb = new TmdbCacheService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.trending',
      name: 'TMDB Trending',
      description: 'Titles trending on TMDB for a media type and time window.',
      mediaTypes: ['movie', 'tv'],
      configFields: [
        { key: 'mediaType', label: 'Media type', type: 'select', required: true, default: 'movie', options: [
          { value: 'movie', label: 'Movies' },
          { value: 'tv', label: 'TV' },
        ] },
        { key: 'timeWindow', label: 'Time window', type: 'select', required: true, default: 'week', options: [
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
        ] },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 20 },
      ],
    };
  }

  async fetchItems(config: TrendingConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const mediaType = config.mediaType === 'tv' ? 'tv' : 'movie';
    const records = await this.tmdb.fetchTrending(ctx.client as never, mediaType, config.timeWindow ?? 'week', {
      language: ctx.tmdbLanguage,
      region: ctx.tmdbRegion,
      limit: limitFromCtx(ctx, config.limit ?? 20),
    });
    return resultFromRecords(records, 'Trending on TMDB', ['tmdb-trending', `tmdb-trending-${mediaType}`], limitFromCtx(ctx, config.limit ?? 20));
  }
}
