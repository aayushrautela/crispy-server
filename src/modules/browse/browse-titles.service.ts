import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { ShortLivedRequestCoalescer } from '../../lib/request-coalescer.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { normalizeMetadataLanguage } from '../metadata/metadata-language.js';
import { buildMetadataCardView } from '../metadata/metadata-card.builders.js';
import { toClientMediaCard } from '../metadata/client-media-card.mapper.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
import { TmdbClient } from '../metadata/providers/tmdb.client.js';
import { TmdbIngestService } from '../metadata/providers/tmdb-ingest.service.js';
import type { TmdbTitleType } from '../metadata/providers/tmdb.types.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';
import { resolveGenreMapping } from '../search/title-search.service.js';

export type BrowseMediaType = 'movie' | 'series';
export type BrowseSort = 'popularity' | 'rating' | 'release';

export type BrowseTitlesInput = {
  type: BrowseMediaType;
  genreKey?: string | null;
  sort: BrowseSort;
  page: number;
  locale?: string | null;
};

export type BrowseTitlesResult = {
  items: ClientMediaCard[];
  total: number;
  hasMore: boolean;
};

const PAGE_SIZE = 50;
const TMDB_PAGE_SIZE = 20;
const MAX_TOTAL = 200;
const MAX_PAGES = MAX_TOTAL / PAGE_SIZE;
const VOTE_COUNT_FLOOR = 30;
const COALESCE_TTL_MS = 3_000;

function sortByFor(sort: BrowseSort, type: BrowseMediaType): string {
  if (sort === 'rating') return 'vote_average.desc';
  if (sort === 'release') return type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc';
  return 'popularity.desc';
}

function floorVotesFor(sort: BrowseSort): boolean {
  return sort !== 'popularity';
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : [];
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return 0;
}

/**
 * Paged, TMDB-discover-backed browse. For each request the TMDB discover
 * endpoint is called for the pages covering the requested window, the hits
 * are persisted through the normal summary path (which grows the shared
 * per-title cache), and the window is hydrated into client cards exactly like
 * the search route. No browse-specific cache layer — repeated requests for a
 * combination get faster as per-title summaries/images accumulate locally.
 */
export class BrowseTitlesService {
  constructor(
    private readonly tmdbClient = new TmdbClient(),
    private readonly ingest = new TmdbIngestService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly requestCoalescer = new ShortLivedRequestCoalescer<BrowseTitlesResult>(COALESCE_TTL_MS),
  ) {}

  async browseTitles(input: BrowseTitlesInput): Promise<BrowseTitlesResult> {
    const key = [
      input.type,
      input.genreKey?.trim().toLowerCase() ?? '',
      input.sort,
      String(input.page),
      normalizeMetadataLanguage(input.locale) ?? '',
    ].join('|');
    return this.requestCoalescer.run(key, () => withDbClient(async (client) => this.browseTitlesInternal(client, input)));
  }

  private async browseTitlesInternal(client: DbClient, input: BrowseTitlesInput): Promise<BrowseTitlesResult> {
    const mediaType: TmdbTitleType = input.type === 'movie' ? 'movie' : 'tv';
    const genreMapping = resolveGenreMapping(input.genreKey);
    const genreId = input.type === 'movie' ? genreMapping?.movieGenreId : genreMapping?.tvGenreId ?? null;
    const sortBy = sortByFor(input.sort, input.type);
    const locale = normalizeMetadataLanguage(input.locale) ?? 'en';

    const start = input.page * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const tmdbStartPage = Math.floor(start / TMDB_PAGE_SIZE) + 1;
    const tmdbEndPage = Math.ceil(end / TMDB_PAGE_SIZE);

    const requests: Array<{ mediaType: TmdbTitleType; tmdbId: number }> = [];
    let total = 0;

    for (let tmdbPage = tmdbStartPage; tmdbPage <= tmdbEndPage; tmdbPage++) {
      const payload = await this.tmdbClient.request(`/discover/${mediaType}`, {
        with_genres: genreId ?? undefined,
        sort_by: sortBy,
        'vote_count.gte': floorVotesFor(input.sort) ? VOTE_COUNT_FLOOR : undefined,
        page: tmdbPage,
        include_adult: 'false',
        language: locale,
      }).catch(() => null);
      if (!payload) continue;

      const discoveredTotal = toNonNegativeInt(payload.total_results);
      if (discoveredTotal > 0) total = discoveredTotal;

      const results = asArray(payload.results);
      if (results.length) {
        await this.ingest.persistSummaries(client, results, mediaType, locale);
        for (const entry of results) {
          const tmdbId = typeof entry.id === 'number' ? entry.id : null;
          if (tmdbId != null && Number.isFinite(tmdbId)) {
            requests.push({ mediaType, tmdbId });
          }
        }
      }
    }

    const cappedTotal = Math.min(total || requests.length, MAX_TOTAL);
    const hasMore = input.page < MAX_PAGES - 1 && cappedTotal > end;
    const items = await this.buildCards(client, requests.slice(0, PAGE_SIZE), locale);
    return { items, total: cappedTotal, hasMore };
  }

  private async buildCards(
    client: DbClient,
    requests: Array<{ mediaType: TmdbTitleType; tmdbId: number }>,
    locale: string,
  ): Promise<ClientMediaCard[]> {
    if (!requests.length) return [];
    const identities = requests.map((request) =>
      inferMediaIdentity({ mediaType: request.mediaType === 'movie' ? 'movie' : 'show', tmdbId: request.tmdbId }),
    );
    const contentIds = await this.contentIdentityService.ensureContentIds(client, identities);
    const hydrated = await this.tmdbCacheService.getTitles(client, requests, locale);

    const cards: ClientMediaCard[] = [];
    for (let index = 0; index < requests.length; index++) {
      const request = requests[index]!;
      const identity = identities[index]!;
      const contentId = contentIds.get(identity.mediaKey);
      const title = hydrated.get(`${request.mediaType}:${request.tmdbId}`);
      if (!contentId || !title) continue;
      const view = buildMetadataCardView({ identity, itemId: encodePublicItemId(contentId), title, language: locale });
      cards.push(toClientMediaCard(view, { progress: null }));
    }
    return cards.filter((card) => {
      const artwork = card.images.artwork;
      return Boolean(artwork && (artwork.small || artwork.medium || artwork.large));
    });
  }
}