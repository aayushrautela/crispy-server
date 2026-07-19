import { TmdbCacheService } from '../../../metadata/providers/tmdb-cache.service.js';
import type { DbClient } from '../../../../lib/db.js';
import type { ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult, ListSourceProvider } from '../list-source.types.js';
import { topGenresForProfile } from './home-watch-signals.js';
import { limitFromCtx, resultFromRecords } from './tmdb-helpers.js';

/**
 * Maps our connected provider session kinds to TMDB watch-provider IDs.
 * Source: TMDB public watch/providers catalog. Only a handful are relevant.
 */
export const CONNECTED_PROVIDER_TO_TMDB: Partial<Record<ListSourceProvider, number[]>> = {
  // Trakt/Simkl are not TMDB streaming providers; they are trackers. We still
  // allow region-filtered popularity when the user has any tracker connected.
  trakt: [],
  simkl: [],
};

void CONNECTED_PROVIDER_TO_TMDB;

type Config = { topN?: number; limit?: number };

export class HomeRecentHistoryByGenreSource implements ListSource<Config> {
  constructor(private readonly tmdb = new TmdbCacheService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'home.recent-history-by-genre',
      name: 'Your Genres (from watch history)',
      description: 'Deterministically picks the genres you watch most and surfaces popular TMDB titles in them.',
      mediaTypes: ['movie', 'tv'],
      configFields: [
        { key: 'topN', label: 'Top genres to use', type: 'number', required: false, default: 2 },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
    };
  }

  async fetchItems(config: Config, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const client = ctx.client as DbClient;
    const topN = Math.max(1, Math.min(config.topN ?? 2, 5));
    const genres = await topGenresForProfile(client, ctx.profileId, 200, topN);
    if (genres.length === 0) {
      return { items: [] };
    }
    const top = genres[0]!;
    const mediaType = top.mediaType;
    const genreId = top.genreId;
    const records = await this.tmdb.discoverTitlesByGenreExtended(client, {
      mediaType,
      genreId,
      language: ctx.tmdbLanguage,
      region: ctx.tmdbRegion,
      sortBy: 'popularity.desc',
      limit: limitFromCtx(ctx, config.limit ?? 40),
    });
    return resultFromRecords(records, 'Because you watch these genres', ['history-genre', `history-genre-${genreId}`], limitFromCtx(ctx, config.limit ?? 40));
  }
}
