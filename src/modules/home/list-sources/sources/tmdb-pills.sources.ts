import type { HomeWriteItemLite, ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult, ListSourceProvider } from '../list-source.types.js';
import { limitFromCtx } from './helpers.js';
import { TmdbClient } from '../../../metadata/providers/tmdb.client.js';

// --- Shared deterministic RNG (copied from the recommendation engine) ---

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: string): { next: () => number; int: (maxExclusive: number) => number } {
  let a = fnv1a32(seed) || 1;
  function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function int(maxExclusive: number): number {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  }
  return { next, int };
}

export function dayKeyUtc(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// --- Small helpers ---

const ANIMATION_GENRE_IDS = new Set([16, 10762]);

function isAnimated(genreIds: unknown): boolean {
  if (!Array.isArray(genreIds)) return false;
  return genreIds.some((g) => ANIMATION_GENRE_IDS.has(Number(g)));
}

function isVoiceRole(character: unknown): boolean {
  if (typeof character !== 'string' || !character) return false;
  const lower = character.toLowerCase();
  return lower.includes('voice') || lower.includes('(voice)') || lower.includes('narrator');
}

function dateDaysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseReleaseTimestamp(dateStr: unknown): number | null {
  if (typeof dateStr !== 'string' || !dateStr) return null;
  const ts = Date.parse(dateStr);
  return Number.isNaN(ts) ? null : ts;
}

function hasReleased(releaseDate: unknown, firstAirDate: unknown, nowMs: number = Date.now()): boolean {
  const ts = parseReleaseTimestamp(releaseDate ?? firstAirDate);
  if (ts === null) return false;
  const startOfToday = Date.parse(new Date(nowMs).toISOString().slice(0, 10));
  return ts <= startOfToday;
}

function toLite(type: 'movie' | 'tv', tmdbId: number): HomeWriteItemLite {
  const ref: { provider: ListSourceProvider; providerId: string } = { provider: 'tmdb', providerId: String(tmdbId) };
  return { type, providerRefs: [ref] };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

type TrendingItem = {
  id: number;
  media_type?: string;
  genre_ids?: unknown;
  credits?: { cast?: Array<{ id: number; name: string; gender: number; popularity: number; character?: string }> };
};

type PersonCastCredit = {
  id: number;
  title?: string;
  name?: string;
  media_type?: string;
  poster_path?: string | null;
  vote_average?: number | null;
  genre_ids?: unknown;
  release_date?: string | null;
  first_air_date?: string | null;
};

// --- Curated genre pool for the daily "fresh" pills ---

const GENRE_POOL: ReadonlyArray<{ tmdbId: number; name: string }> = [
  { tmdbId: 28, name: 'Action' },
  { tmdbId: 35, name: 'Comedy' },
  { tmdbId: 27, name: 'Horror' },
  { tmdbId: 878, name: 'Science Fiction' },
  { tmdbId: 10749, name: 'Romance' },
  { tmdbId: 53, name: 'Thriller' },
  { tmdbId: 16, name: 'Animation' },
  { tmdbId: 99, name: 'Documentary' },
  { tmdbId: 80, name: 'Crime' },
  { tmdbId: 14, name: 'Fantasy' },
];

/**
 * Deterministic daily shuffle of the genre pool. Two sources (pick=1, pick=2)
 * read distinct slots from the same shuffle so a daily run yields two different
 * genres that stay stable until the next snapshot rebuild.
 */
export function dailyGenreOrder(dayKey: string): Array<{ tmdbId: number; name: string }> {
  const order = [...GENRE_POOL];
  const rng = createRng(`pills-${dayKey}`);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

// --- Trending person (actor / actress) pill ---

const PILLS_TRENDING_FETCH_LIMIT = 5;
const PILLS_TRENDING_USE_LIMIT = 2;
const PILLS_MIN_ITEMS = 3;

type TrendingPersonConfig = { gender: 'actor' | 'actress'; limit?: number };

export class TmdbTrendingPersonSource implements ListSource<TrendingPersonConfig> {
  constructor(private readonly tmdb = new TmdbClient()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.trending-person',
      name: 'TMDB Trending Person',
      description: 'A trending actor or actress and their recent popular filmography.',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'tmdb',
      configFields: [
        {
          key: 'gender',
          label: 'Person type',
          type: 'select',
          required: true,
          default: 'actor',
          options: [
            { value: 'actor', label: 'Actor' },
            { value: 'actress', label: 'Actress' },
          ],
        },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'trending-actor', label: 'Trending Actor', sourceConfig: { gender: 'actor' } },
        { id: 'trending-actress', label: 'Trending Actress', sourceConfig: { gender: 'actress' } },
      ],
    };
  }

  suggestListKey(config: TrendingPersonConfig): string {
    return `tmdb-trending-${config.gender}`;
  }

  async fetchItems(config: TrendingPersonConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const language = ctx.tmdbLanguage ?? 'en';
    const genderFilter = config.gender === 'actress' ? 1 : 2;
    const limit = limitFromCtx(ctx, config.limit ?? 40);

    const [movieTrending, showTrending] = await Promise.all([
      this.tmdb.request('/trending/movie/day', { language, page: 1 }).catch(() => ({ results: [] as unknown[] })) as Promise<{ results?: unknown[] }>,
      this.tmdb.request('/trending/tv/day', { language, page: 1 }).catch(() => ({ results: [] as unknown[] })) as Promise<{ results?: unknown[] }>,
    ]);

    const candidates: TrendingItem[] = [...(movieTrending.results ?? []), ...(showTrending.results ?? [])]
      .filter((r) => !isAnimated((r as TrendingItem).genre_ids))
      .slice(0, PILLS_TRENDING_FETCH_LIMIT) as TrendingItem[];

    const fetched: TrendingItem[] = [];
    for (const item of candidates) {
      if (fetched.length >= PILLS_TRENDING_USE_LIMIT) break;
      const path = item.media_type === 'tv' ? `/tv/${item.id}` : `/movie/${item.id}`;
      try {
        const details = await this.tmdb.request(path, { language, append_to_response: 'credits' }) as TrendingItem;
        const cast = Array.isArray(details.credits?.cast) ? details.credits!.cast!.filter((c) => !isVoiceRole(c.character)) : [];
        fetched.push({ ...item, credits: { cast } });
      } catch (err) {
        console.error(`tmdb.trending-person credits fetch failed for ${item.id}:`, err);
      }
    }

    const aggregate = new Map<number, { name: string; appearances: number; popularity: number; gender: number }>();
    for (const title of fetched) {
      for (const cast of title.credits?.cast ?? []) {
        if (cast.gender !== genderFilter || !cast.name) continue;
        if (cast.popularity == null || cast.popularity < 0) continue;
        const existing = aggregate.get(cast.id) ?? { name: cast.name, appearances: 0, popularity: cast.popularity, gender: cast.gender };
        existing.appearances += 1;
        existing.popularity = Math.max(existing.popularity, cast.popularity);
        aggregate.set(cast.id, existing);
      }
    }

    let best: { id: number; name: string; score: number } | null = null;
    for (const [personId, info] of aggregate) {
      const score = info.appearances * 10 + info.popularity;
      if (!best || score > best.score) best = { id: personId, name: info.name, score };
    }
    if (!best) return { items: [] };

    let personDetails: { combined_credits?: { cast?: PersonCastCredit[] } };
    try {
      personDetails = await this.tmdb.request(`/person/${best.id}`, { language, append_to_response: 'combined_credits' }) as { combined_credits?: { cast?: PersonCastCredit[] } };
    } catch (err) {
      console.error(`tmdb.trending-person person details failed for ${best.id}:`, err);
      return { items: [] };
    }

    const filmography = (personDetails.combined_credits?.cast ?? [])
      .filter((c) => c.id && (c.title || c.name) && c.poster_path && !isAnimated(c.genre_ids) && hasReleased(c.release_date, c.first_air_date))
      .map((c) => ({
        id: c.id,
        type: (c.media_type === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv',
        release: c.release_date ?? c.first_air_date ?? null,
        vote: c.vote_average ?? null,
      }))
      .sort((a, b) => {
        const aTs = parseReleaseTimestamp(a.release);
        const bTs = parseReleaseTimestamp(b.release);
        if (aTs === null && bTs === null) return (b.vote ?? 0) - (a.vote ?? 0);
        if (aTs === null) return 1;
        if (bTs === null) return -1;
        if (bTs !== aTs) return bTs - aTs;
        return (b.vote ?? 0) - (a.vote ?? 0);
      })
      .slice(0, limit)
      .map((c) => toLite(c.type, c.id));

    if (filmography.length < PILLS_MIN_ITEMS) return { items: [] };

    return {
      items: filmography,
      meta: { title: best.name, subtitle: 'Trending today' },
    };
  }
}

// --- New this week (movies / shows) pill ---

const PILLS_NEW_DAYS = 7;

type NewThisWeekConfig = { mediaType: 'movie' | 'tv'; limit?: number };

export class TmdbNewThisWeekSource implements ListSource<NewThisWeekConfig> {
  constructor(private readonly tmdb = new TmdbClient()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.new-this-week',
      name: 'TMDB New This Week',
      description: 'Recently released or premiered titles from TMDB.',
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
        { id: 'new-movies', label: 'New Movies', sourceConfig: { mediaType: 'movie' } },
        { id: 'new-shows', label: 'New Shows', sourceConfig: { mediaType: 'tv' } },
      ],
    };
  }

  suggestListKey(config: NewThisWeekConfig): string {
    return `tmdb-new-${config.mediaType}`;
  }

  async fetchItems(config: NewThisWeekConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const language = ctx.tmdbLanguage ?? 'en';
    const limit = limitFromCtx(ctx, config.limit ?? 40);

    let results: Array<Record<string, unknown>> = [];
    try {
      if (config.mediaType === 'tv') {
        const raw = await this.tmdb.request('/discover/tv', {
          language,
          sort_by: 'popularity.desc',
          'first_air_date.gte': dateDaysAgoISO(PILLS_NEW_DAYS),
          'first_air_date.lte': todayISO(),
          page: 1,
        });
        results = (raw.results ?? []) as Array<Record<string, unknown>>;
      } else {
        const raw = await this.tmdb.request('/movie/now_playing', {
          language,
          region: ctx.tmdbRegion,
          page: 1,
        });
        results = (raw.results ?? []) as Array<Record<string, unknown>>;
      }
    } catch (err) {
      console.error(`tmdb.new-this-week failed for ${config.mediaType}:`, err);
      return { items: [] };
    }

    const items = results
      .map((r) => ({ id: asNumber(r.id), type: config.mediaType }))
      .filter((r) => r.id > 0)
      .slice(0, limit)
      .map((r) => toLite(r.type, r.id));

    if (items.length === 0) return { items: [] };

    return {
      items,
      meta: { title: config.mediaType === 'tv' ? 'New Shows This Week' : 'New This Week' },
    };
  }
}

// --- Genre fresh pill (daily random genre) ---

const PILLS_RECENT_DAYS = 90;

type GenreFreshConfig = { pick: number; limit?: number };

export class TmdbGenreFreshSource implements ListSource<GenreFreshConfig> {
  constructor(private readonly tmdb = new TmdbClient()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'tmdb.genre-fresh',
      name: 'TMDB Genre Fresh',
      description: 'Recent popular titles from a genre, picked at random from a curated pool per daily run.',
      mediaTypes: ['movie'],
      requiresProvider: 'tmdb',
      configFields: [
        { key: 'pick', label: 'Daily pick slot (1 or 2)', type: 'number', required: true, default: 1 },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'genre-fresh-1', label: 'Fresh Pick 1', sourceConfig: { pick: 1 } },
        { id: 'genre-fresh-2', label: 'Fresh Pick 2', sourceConfig: { pick: 2 } },
      ],
    };
  }

  suggestListKey(config: GenreFreshConfig): string {
    return `tmdb-genre-fresh-${config.pick}`;
  }

  async fetchItems(config: GenreFreshConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const language = ctx.tmdbLanguage ?? 'en';
    const limit = limitFromCtx(ctx, config.limit ?? 40);

    const order = dailyGenreOrder(dayKeyUtc(Date.now()));
    const slot = Math.min(Math.max(1, Math.floor(config.pick) || 1), order.length) - 1;
    const genre = order[slot];
    if (!genre) return { items: [] };

    let results: Array<Record<string, unknown>> = [];
    try {
      const raw = await this.tmdb.request('/discover/movie', {
        language,
        sort_by: 'popularity.desc',
        with_genres: genre.tmdbId,
        'primary_release_date.gte': dateDaysAgoISO(PILLS_RECENT_DAYS),
        'primary_release_date.lte': todayISO(),
        page: 1,
      });
      results = (raw.results ?? []) as Array<Record<string, unknown>>;
    } catch (err) {
      console.error(`tmdb.genre-fresh failed for genre ${genre.name}:`, err);
      return { items: [] };
    }

    const items = results
      .map((r) => ({ id: asNumber(r.id), title: asString(r.title) }))
      .filter((r) => r.id > 0 && r.title)
      .slice(0, limit)
      .map((r) => toLite('movie', r.id));

    if (items.length === 0) return { items: [] };

    return {
      items,
      meta: { title: `${genre.name} — Fresh`, subtitle: `Recent ${genre.name.toLowerCase()}` },
    };
  }
}
