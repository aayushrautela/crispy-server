import { TmdbCacheService } from '../../../metadata/providers/tmdb-cache.service.js';
import type { ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult } from '../list-source.types.js';
import { limitFromCtx, resultFromRecords } from './tmdb-helpers.js';

type Config = { mediaType: 'movie' | 'tv'; limit?: number };

/**
 * Region-aware popularity. Uses the profile's region (and optionally connected
 * streaming providers) to filter TMDB popular titles. Purely deterministic.
 */
export class HomePopularInRegionSource implements ListSource<Config> {
  constructor(private readonly tmdb = new TmdbCacheService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'home.popular-in-region',
      name: 'Popular in your region',
      description: 'Popular TMDB titles filtered by the profile region (and connected streaming providers if any).',
      mediaTypes: ['movie', 'tv'],
      configFields: [
        { key: 'mediaType', label: 'Media type', type: 'select', required: true, default: 'movie', options: [
          { value: 'movie', label: 'Movies' },
          { value: 'tv', label: 'TV' },
        ] },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
    };
  }

  async fetchItems(config: Config, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const mediaType = config.mediaType === 'tv' ? 'tv' : 'movie';
    const hasRegion = Boolean(ctx.tmdbRegion);
    const records = await this.tmdb.fetchPopular(ctx.client as never, mediaType, {
      language: ctx.tmdbLanguage,
      region: ctx.tmdbRegion ?? undefined,
      limit: limitFromCtx(ctx, config.limit ?? 40),
    });
    const reason = hasRegion ? 'Popular in your region' : 'Popular right now';
    const reasonCodes = hasRegion ? ['popular-region', `popular-region-${ctx.tmdbRegion}`] : ['popular-global'];
    return resultFromRecords(records, reason, reasonCodes, limitFromCtx(ctx, config.limit ?? 40));
  }
}
