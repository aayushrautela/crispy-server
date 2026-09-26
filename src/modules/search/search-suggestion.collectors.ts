import { appConfig } from '../../config/app-config.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { MdbListClient } from '../integrations/mdblist.client.js';
import { TmdbClient } from '../metadata/providers/tmdb.client.js';
import { normalizeSuggestionName, type SuggestionSource } from './search-suggestion.ranking.js';

export type CollectedSuggestion = {
  name: string;
  normalizedName: string;
  rank: number;
};

export type CollectedSource = {
  entries: CollectedSuggestion[];
  /** Upstream edit stamp when the provider exposes one; null for TMDB. */
  upstreamUpdatedAt: string | null;
};

const TMDB_PAGES_PER_SOURCE = 5;
const TMDB_PAGE_SIZE = 20;
const MDBLIST_PAGE_LIMIT = 500;

/**
 * Weekly rotation. Stale trending is actively misleading, so this source is
 * replaced on a short cadence.
 */
const TRENDING_PATHS = ['/trending/movie/week', '/trending/tv/week', '/trending/all/week'];

/**
 * All-time popularity plus top rated. `/person/popular` is included because
 * /v1/search/titles searches people too, so those names must stay suggestible.
 */
const POPULAR_PATHS = [
  '/movie/popular',
  '/tv/popular',
  '/movie/top_rated',
  '/tv/top_rated',
  '/person/popular',
];

export class SearchSuggestionCollector {
  private readonly tmdbClient = new TmdbClient();
  private readonly mdblistClient = new MdbListClient();

  /**
   * `classicsUpstreamStamp` lets a caller that already read the stamp for
   * change detection hand it over, so a refresh costs one metadata call rather
   * than two that could disagree if the list is edited mid-run.
   */
  async collect(source: SuggestionSource, options: { classicsUpstreamStamp?: string | null } = {}): Promise<CollectedSource> {
    if (source === 'classics') {
      return this.collectClassics(options.classicsUpstreamStamp);
    }
    return this.collectTmdb(source === 'trending' ? TRENDING_PATHS : POPULAR_PATHS);
  }

  /**
   * The curated upstream `updated` stamp for classics, so a refresh can be
   * skipped when the human-curated list has not changed.
   */
  async readClassicsUpstreamStamp(): Promise<string | null> {
    const { classicsListUsername, classicsListSlug } = appConfig.metadata.searchSuggestions;
    const payload = await this.mdblistClient.fetchList(
      classicsListUsername,
      classicsListSlug,
      requireMdblistApiKey(),
    );
    if (!Array.isArray(payload)) {
      return null;
    }
    const stamps = payload
      .map((row) => asRecord(row).updated)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return stamps.sort().at(-1) ?? null;
  }

  private async collectTmdb(paths: string[]): Promise<CollectedSource> {
    const names: string[] = [];

    for (const path of paths) {
      for (let page = 1; page <= TMDB_PAGES_PER_SOURCE; page += 1) {
        const payload = await this.tmdbClient.request(path, { page, language: 'en-US' });
        const results = Array.isArray(payload.results) ? payload.results : [];
        if (results.length === 0) {
          break;
        }
        for (const raw of results) {
          const row = asRecord(raw);
          // A suggestion is a name, so movie/show/person are deliberately not
          // distinguished: /v1/search/titles resolves all three from the name.
          const name = firstNonEmptyString(row.name, row.title, row.original_name);
          if (name) {
            names.push(name);
          }
        }
        if (results.length < TMDB_PAGE_SIZE) {
          break;
        }
      }
    }

    return { entries: toRankedEntries(names), upstreamUpdatedAt: null };
  }

  private async collectClassics(knownStamp?: string | null): Promise<CollectedSource> {
    const { classicsListUsername, classicsListSlug, maxMovies, maxShows } = appConfig.metadata.searchSuggestions;
    const apiKey = requireMdblistApiKey();
    // The stamp is read before the rows are collected so a mid-run upstream edit
    // cannot make us record a newer stamp than the rows we actually stored.
    const upstreamUpdatedAt = knownStamp === undefined ? await this.readClassicsUpstreamStamp() : knownStamp;

    const names: string[] = [];
    // MDBList paginates each media type independently, so both passes start at 0.
    for (const [mediaType, limit] of [['movie', maxMovies], ['show', maxShows]] as const) {
      let taken = 0;
      let offset = 0;
      while (taken < limit) {
        const pageSize = Math.min(MDBLIST_PAGE_LIMIT, limit - taken);
        const rows = await this.mdblistClient.fetchListItems(
          classicsListUsername,
          classicsListSlug,
          apiKey,
          { mediaType, limit: pageSize, offset },
        );
        if (rows.length === 0) {
          break;
        }
        for (const raw of rows) {
          const row = asRecord(raw);
          // tmdb ids are kept out of the table on purpose: a suggestion is not a
          // resolvable item, so the id is only used to skip rows we cannot name.
          if (typeof asRecord(row.ids).tmdb !== 'number') {
            continue;
          }
          const name = firstNonEmptyString(row.title, row.name);
          if (name) {
            names.push(name);
            taken += 1;
          }
        }
        if (rows.length < pageSize) {
          break;
        }
        offset += pageSize;
      }
    }

    return { entries: toRankedEntries(names), upstreamUpdatedAt };
  }
}

/** Normalize, drop unusable and duplicate names, then number the survivors. */
function toRankedEntries(names: string[]): CollectedSuggestion[] {
  const entries: CollectedSuggestion[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    const normalizedName = normalizeSuggestionName(name);
    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }
    seen.add(normalizedName);
    entries.push({ name, normalizedName, rank: entries.length });
  }
  return entries;
}

function requireMdblistApiKey(): string {
  const apiKey = env.mdblistApiKey.trim();
  if (!apiKey) {
    throw new HttpError(503, 'MDBLIST_API_KEY is not configured.');
  }
  return apiKey;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
