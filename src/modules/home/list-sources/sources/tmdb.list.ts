import { TmdbCacheService } from '../../../metadata/providers/tmdb-cache.service.js';
import type { ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult } from '../list-source.types.js';
import { limitFromCtx, resultFromRecords } from './tmdb-helpers.js';

type Config = { listId: number; limit?: number };

export class TmdbListSource implements ListSource<Config> {
  constructor(private readonly tmdb = new TmdbCacheService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.list',
      name: 'TMDB List',
      description: 'A curated TMDB public list by ID.',
      mediaTypes: ['movie', 'tv'],
      configFields: [
        { key: 'listId', label: 'TMDB list ID', type: 'number', required: true },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
    };
  }

  async fetchItems(config: Config, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const listId = Number(config.listId);
    if (!Number.isInteger(listId) || listId <= 0) {
      return { items: [] };
    }
    const records = await this.tmdb.fetchTmdbList(ctx.client as never, listId, {
      language: ctx.tmdbLanguage,
      limit: limitFromCtx(ctx, config.limit ?? 40),
    });
    return resultFromRecords(records, 'Curated TMDB list', ['tmdb-list'], limitFromCtx(ctx, config.limit ?? 40));
  }
}
