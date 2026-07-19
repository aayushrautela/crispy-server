import { TmdbCacheService } from '../../../metadata/providers/tmdb-cache.service.js';
import type { ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult } from '../list-source.types.js';
import { limitFromCtx, resultFromRecords } from './tmdb-helpers.js';

export const TMDB_GENRES: Array<{ value: string; label: string; movieId: number; tvId: number }> = [
  { value: 'action', label: 'Action', movieId: 28, tvId: 10759 },
  { value: 'adventure', label: 'Adventure', movieId: 12, tvId: 10759 },
  { value: 'animation', label: 'Animation', movieId: 16, tvId: 16 },
  { value: 'comedy', label: 'Comedy', movieId: 35, tvId: 35 },
  { value: 'crime', label: 'Crime', movieId: 18, tvId: 80 },
  { value: 'documentary', label: 'Documentary', movieId: 99, tvId: 99 },
  { value: 'drama', label: 'Drama', movieId: 18, tvId: 18 },
  { value: 'family', label: 'Family', movieId: 10751, tvId: 10751 },
  { value: 'fantasy', label: 'Fantasy', movieId: 14, tvId: 10765 },
  { value: 'history', label: 'History', movieId: 36, tvId: 36 },
  { value: 'horror', label: 'Horror', movieId: 27, tvId: 9648 },
  { value: 'music', label: 'Music', movieId: 10402, tvId: 10402 },
  { value: 'mystery', label: 'Mystery', movieId: 9648, tvId: 9648 },
  { value: 'romance', label: 'Romance', movieId: 10749, tvId: 10749 },
  { value: 'sci-fi', label: 'Sci-Fi', movieId: 878, tvId: 10765 },
  { value: 'thriller', label: 'Thriller', movieId: 53, tvId: 53 },
  { value: 'war', label: 'War', movieId: 10752, tvId: 10768 },
  { value: 'western', label: 'Western', movieId: 37, tvId: 37 },
];

function resolveGenreId(value: unknown, mediaType: 'movie' | 'tv'): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = TMDB_GENRES.find((g) => g.value === value);
  return match ? (mediaType === 'tv' ? match.tvId : match.movieId) : null;
}

type Config = {
  mediaType: 'movie' | 'tv';
  genreId?: number | string | null;
  genre?: string;
  sortBy?: string;
  voteAverageGte?: number;
  releaseYear?: number;
  limit?: number;
};

export class TmdbDiscoverByGenreSource implements ListSource<Config> {
  constructor(private readonly tmdb = new TmdbCacheService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.discover-by-genre',
      name: 'TMDB Discover by Genre',
      description: 'Discover titles filtered by genre, sorted by popularity or release date.',
      mediaTypes: ['movie', 'tv'],
      configFields: [
        { key: 'mediaType', label: 'Media type', type: 'select', required: true, default: 'movie', options: [
          { value: 'movie', label: 'Movies' },
          { value: 'tv', label: 'TV' },
        ] },
        { key: 'genre', label: 'Genre', type: 'select', required: false, default: 'action', options: TMDB_GENRES.map((g) => ({ value: g.value, label: g.label })) },
        { key: 'genreId', label: 'Genre ID (override)', type: 'number', required: false },
        { key: 'sortBy', label: 'Sort by', type: 'select', required: false, default: 'popularity.desc', options: [
          { value: 'popularity.desc', label: 'Popularity' },
          { value: 'release_date.desc', label: 'Release date (newest)' },
          { value: 'vote_average.desc', label: 'Rating' },
        ] },
        { key: 'voteAverageGte', label: 'Min rating', type: 'number', required: false },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
    };
  }

  async fetchItems(config: Config, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const mediaType = config.mediaType === 'tv' ? 'tv' : 'movie';
    const genreId = config.genreId != null ? resolveGenreId(config.genreId, mediaType) : (config.genre ? resolveGenreId(config.genre, mediaType) : null);
    const records = await this.tmdb.discoverTitlesByGenreExtended(ctx.client as never, {
      mediaType,
      genreId,
      language: ctx.tmdbLanguage,
      region: ctx.tmdbRegion,
      voteAverageGte: typeof config.voteAverageGte === 'number' ? config.voteAverageGte : undefined,
      releaseYear: typeof config.releaseYear === 'number' ? config.releaseYear : undefined,
      sortBy: config.sortBy ?? 'popularity.desc',
      limit: limitFromCtx(ctx, config.limit ?? 40),
    });
    return resultFromRecords(records, genreId ? 'Popular in your genres' : 'New releases', ['tmdb-discover', `tmdb-discover-${mediaType}`], limitFromCtx(ctx, config.limit ?? 40));
  }
}
