import { TmdbCacheService } from '../../../metadata/providers/tmdb-cache.service.js';
import type { TmdbTitleRecord, TmdbTitleType } from '../../../metadata/providers/tmdb.types.js';
import type { ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult } from '../list-source.types.js';
import { limitFromCtx, resultFromRecords } from './tmdb-helpers.js';

type Config = { mediaType: 'movie' | 'tv'; limit?: number };

type Fetcher = (tmdb: TmdbCacheService, client: unknown, mediaType: TmdbTitleType, opts: { page?: number; language?: string; region?: string; limit?: number }) => Promise<TmdbTitleRecord[]>;

function mediaTypeField() {
  return { key: 'mediaType', label: 'Media type', type: 'select' as const, required: true, default: 'movie', options: [
    { value: 'movie', label: 'Movies' },
    { value: 'tv', label: 'TV' },
  ] };
}

function limitField() {
  return { key: 'limit', label: 'Max items', type: 'number' as const, required: false, default: 40 };
}

export function createTmdbListSource(opts: {
  id: string;
  name: string;
  description: string;
  reason: string;
  reasonCodes: string[];
  fetcher: Fetcher;
  forceMediaType?: TmdbTitleType;
}): ListSource<Config> {
  return new (class implements ListSource<Config> {
    private readonly tmdb = new TmdbCacheService();
    descriptor(): ListSourceDescriptor {
      return {
        id: opts.id,
        name: opts.name,
        description: opts.description,
        mediaTypes: opts.forceMediaType ? [opts.forceMediaType] : ['movie', 'tv'],
        configFields: opts.forceMediaType ? [limitField()] : [mediaTypeField(), limitField()],
      };
    }
    async fetchItems(config: Config, ctx: ListSourceCtx): Promise<ListSourceResult> {
      const mediaType: TmdbTitleType = opts.forceMediaType ?? (config.mediaType === 'tv' ? 'tv' : 'movie');
      const records = await opts.fetcher(this.tmdb, ctx.client, mediaType, {
        language: ctx.tmdbLanguage,
        region: ctx.tmdbRegion,
        limit: limitFromCtx(ctx, config.limit ?? 40),
      });
      return resultFromRecords(records, opts.reason, opts.reasonCodes, limitFromCtx(ctx, config.limit ?? 40));
    }
  })();
}

export const tmdbPopularSource = createTmdbListSource({
  id: 'tmdb.popular',
  name: 'TMDB Popular',
  description: 'Popular titles on TMDB.',
  reason: 'Popular on TMDB',
  reasonCodes: ['tmdb-popular'],
  fetcher: (tmdb, client, mediaType, o) => tmdb.fetchPopular(client as never, mediaType, o),
});

export const tmdbTopRatedSource = createTmdbListSource({
  id: 'tmdb.top-rated',
  name: 'TMDB Top Rated',
  description: 'Top rated titles on TMDB.',
  reason: 'Top rated on TMDB',
  reasonCodes: ['tmdb-top-rated'],
  fetcher: (tmdb, client, mediaType, o) => tmdb.fetchTopRated(client as never, mediaType, o),
});

export const tmdbNowPlayingSource = createTmdbListSource({
  id: 'tmdb.now-playing',
  name: 'TMDB Now Playing',
  description: 'Movies now playing in theaters.',
  reason: 'Now playing',
  reasonCodes: ['tmdb-now-playing'],
  fetcher: (tmdb, client, _mediaType, o) => tmdb.fetchNowPlaying(client as never, o),
  forceMediaType: 'movie',
});

export const tmdbAiringTodaySource = createTmdbListSource({
  id: 'tmdb.airing-today',
  name: 'TMDB Airing Today',
  description: 'TV shows airing today.',
  reason: 'Airing today',
  reasonCodes: ['tmdb-airing-today'],
  fetcher: (tmdb, client, _mediaType, o) => tmdb.fetchAiringToday(client as never, o),
  forceMediaType: 'tv',
});

export const tmdbUpcomingSource = createTmdbListSource({
  id: 'tmdb.upcoming',
  name: 'TMDB Upcoming',
  description: 'Upcoming movie releases.',
  reason: 'Upcoming',
  reasonCodes: ['tmdb-upcoming'],
  fetcher: (tmdb, client, _mediaType, o) => tmdb.fetchUpcoming(client as never, o),
  forceMediaType: 'movie',
});
