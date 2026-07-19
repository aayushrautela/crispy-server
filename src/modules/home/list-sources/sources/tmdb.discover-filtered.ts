import { TmdbCacheService } from '../../../metadata/providers/tmdb-cache.service.js';
import type { TmdbTitleRecord, TmdbTitleType } from '../../../metadata/providers/tmdb.types.js';
import type { ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult } from '../list-source.types.js';
import { limitFromCtx, resultFromRecords } from './tmdb-helpers.js';
import { TMDB_GENRES, TMDB_LANGUAGES, resolveGenreId, tmdbYearOptions } from './tmdb-static-data.js';

export type FilteredFeed =
  | 'trending-day'
  | 'trending-week'
  | 'popular'
  | 'top-rated'
  | 'now-playing'
  | 'airing-today'
  | 'upcoming'
  | 'discover';

export type FilteredConfig = {
  feed: FilteredFeed;
  mediaType: 'movie' | 'tv';
  genre?: string | null;
  year?: number | string | null;
  originalLanguage?: string | null;
  sortBy?: 'popularity.desc' | 'release_date.desc' | 'vote_average.desc';
  minRating?: number | string | null;
  maxItems?: number | null;
};

const FEED_OPTIONS = [
  { value: 'trending-day', label: 'Trending (day)' },
  { value: 'trending-week', label: 'Trending (week)' },
  { value: 'popular', label: 'Popular' },
  { value: 'top-rated', label: 'Top rated' },
  { value: 'now-playing', label: 'Now playing (theatrical)' },
  { value: 'airing-today', label: 'Airing today (TV)' },
  { value: 'upcoming', label: 'Upcoming (theatrical)' },
  { value: 'discover', label: 'Discover (advanced filters)' },
];

const SORT_OPTIONS = [
  { value: 'popularity.desc', label: 'Popularity' },
  { value: 'release_date.desc', label: 'Release date (newest)' },
  { value: 'vote_average.desc', label: 'Rating' },
];

const MAX_ITEMS_OPTIONS = [
  { value: '10', label: '10' },
  { value: '20', label: '20' },
  { value: '40', label: '40' },
  { value: '60', label: '60' },
  { value: '100', label: '100' },
];

const MIN_RATING_OPTIONS = [
  { value: '', label: 'Any rating' },
  { value: '5', label: '5+' },
  { value: '6', label: '6+' },
  { value: '7', label: '7+' },
  { value: '8', label: '8+' },
];

function asNumberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Feeds whose TMDB endpoint only supports movies. */
const MOVIE_ONLY_FEEDS: ReadonlySet<FilteredFeed> = new Set(['now-playing', 'upcoming']);
/** Feeds whose TMDB endpoint only supports tv. */
const TV_ONLY_FEEDS: ReadonlySet<FilteredFeed> = new Set(['airing-today']);

export class TmdbDiscoverFilteredSource implements ListSource<FilteredConfig> {
  constructor(private readonly tmdb = new TmdbCacheService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.discover-filtered',
      name: 'TMDB (filtered)',
      description: 'TMDB feed with genre, year, language, sort and rating filters, all as dropdowns.',
      mediaTypes: ['movie', 'tv'],
      configFields: [
        { key: 'feed', label: 'Feed', type: 'select', required: true, default: 'popular', options: FEED_OPTIONS },
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
        { key: 'genre', label: 'Genre', type: 'select', required: false, default: '', options: [{ value: '', label: 'Any genre' }, ...TMDB_GENRES.map((g) => ({ value: g.value, label: g.label }))] },
        { key: 'year', label: 'Release year', type: 'select', required: false, default: '', options: tmdbYearOptions() as { value: string; label: string }[] },
        { key: 'originalLanguage', label: 'Original language', type: 'select', required: false, default: '', options: TMDB_LANGUAGES as { value: string; label: string }[] },
        { key: 'sortBy', label: 'Sort by', type: 'select', required: false, default: 'popularity.desc', options: SORT_OPTIONS },
        { key: 'minRating', label: 'Min rating', type: 'select', required: false, default: '', options: MIN_RATING_OPTIONS },
        { key: 'maxItems', label: 'Max items (fetched)', type: 'select', required: false, default: '20', options: MAX_ITEMS_OPTIONS },
      ],
    };
  }

  suggestListKey(config: FilteredConfig): string {
    return suggestListKey(config);
  }

  async fetchItems(config: FilteredConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const mediaType: TmdbTitleType =
      MOVIE_ONLY_FEEDS.has(config.feed) ? 'movie' : TV_ONLY_FEEDS.has(config.feed) ? 'tv' : config.mediaType === 'tv' ? 'tv' : 'movie';

    const requestedLimit = asNumberOrNull(config.maxItems) ?? 20;
    const limit = limitFromCtx(ctx, requestedLimit);

    const language = ctx.tmdbLanguage ?? undefined;
    const region = ctx.tmdbRegion ?? undefined;

    let records: TmdbTitleRecord[];
    let reason = 'TMDB';
    let reasonCodes = ['tmdb-filtered'];

    switch (config.feed) {
      case 'trending-day':
      case 'trending-week': {
        const window = config.feed === 'trending-day' ? 'day' : 'week';
        records = await this.tmdb.fetchTrending(ctx.client as never, mediaType, window, { language, region, limit });
        reason = `Trending (${window})`;
        reasonCodes = ['tmdb-trending', `tmdb-trending-${mediaType}`];
        break;
      }
      case 'popular': {
        records = await this.tmdb.fetchPopular(ctx.client as never, mediaType, { language, region, limit });
        reason = 'Popular on TMDB';
        reasonCodes = ['tmdb-popular', `tmdb-popular-${mediaType}`];
        break;
      }
      case 'top-rated': {
        records = await this.tmdb.fetchTopRated(ctx.client as never, mediaType, { language, region, limit });
        reason = 'Top rated on TMDB';
        reasonCodes = ['tmdb-top-rated', `tmdb-top-rated-${mediaType}`];
        break;
      }
      case 'now-playing': {
        records = await this.tmdb.fetchNowPlaying(ctx.client as never, { language, region, limit });
        reason = 'Now playing';
        reasonCodes = ['tmdb-now-playing'];
        break;
      }
      case 'airing-today': {
        records = await this.tmdb.fetchAiringToday(ctx.client as never, { language, region, limit });
        reason = 'Airing today';
        reasonCodes = ['tmdb-airing-today'];
        break;
      }
      case 'upcoming': {
        records = await this.tmdb.fetchUpcoming(ctx.client as never, { language, region, limit });
        reason = 'Upcoming';
        reasonCodes = ['tmdb-upcoming'];
        break;
      }
      case 'discover':
      default: {
        const genreId = config.genre ? resolveGenreId(config.genre, mediaType) : null;
        const year = asNumberOrNull(config.year);
        const minRating = asNumberOrNull(config.minRating);
        const originalLanguage = config.originalLanguage ? String(config.originalLanguage) : undefined;
        records = await this.tmdb.discoverTitlesByGenreExtended(ctx.client as never, {
          mediaType,
          genreId,
          language,
          region,
          voteAverageGte: minRating ?? undefined,
          releaseYear: year ?? undefined,
          originalLanguage,
          sortBy: config.sortBy ?? 'popularity.desc',
          limit,
        });
        reason = genreId ? 'Popular in your genres' : 'New releases';
        reasonCodes = ['tmdb-discover', `tmdb-discover-${mediaType}`];
        break;
      }
    }

    // Non-discover feeds don't accept genre/year/originalLanguage/minRating on the
    // TMDB side. Enforce them client-side so the rail is accurately filtered.
    const filtered = this.postFilter(records, config);
    return resultFromRecords(filtered, reason, reasonCodes, limit);
  }

  private postFilter(records: TmdbTitleRecord[], config: FilteredConfig): TmdbTitleRecord[] {
    if (config.feed === 'discover') return records;

    const genreId = config.genre ? resolveGenreId(config.genre, config.mediaType === 'tv' ? 'tv' : 'movie') : null;
    const year = asNumberOrNull(config.year);
    const minRating = asNumberOrNull(config.minRating);
    const lang = config.originalLanguage ? String(config.originalLanguage) : '';

    if (genreId == null && year == null && minRating == null && !lang) {
      return records;
    }

    const out: TmdbTitleRecord[] = [];
    for (const r of records) {
      const raw = r.raw ?? {};

      if (genreId != null) {
        const genreIds = Array.isArray(raw.genre_ids) ? (raw.genre_ids as unknown[]) : [];
        if (!genreIds.map((g) => Number(g)).includes(genreId)) continue;
      }

      if (year != null) {
        const dateStr = typeof raw.release_date === 'string' ? raw.release_date : typeof raw.first_air_date === 'string' ? raw.first_air_date : '';
        const y = dateStr ? Number(dateStr.slice(0, 4)) : NaN;
        if (y !== year) continue;
      }

      if (minRating != null) {
        const vote = typeof raw.vote_average === 'number' ? raw.vote_average : NaN;
        if (vote < minRating) continue;
      }

      if (lang) {
        const orig = typeof raw.original_language === 'string' ? raw.original_language : '';
        if (orig !== lang) continue;
      }

      out.push(r);
    }
    return out;
  }
}

/**
 * Derive a stable, human-readable list key from the config. Empty/Any segments
 * are omitted. Callers should de-duplicate on collision by appending -2, -3.
 */
export function suggestListKey(config: FilteredConfig): string {
  const parts: string[] = ['tmdb', config.feed];
  parts.push(config.mediaType);
  if (config.genre) parts.push(String(config.genre));
  if (config.year) parts.push(String(config.year));
  if (config.originalLanguage) parts.push(String(config.originalLanguage));
  return parts.join('-');
}
