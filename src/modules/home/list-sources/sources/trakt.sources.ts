import { TraktListService } from '../../../integrations/trakt/trakt-list.service.js';
import type { HomeWriteItemLite, ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult, ListSourceProvider } from '../list-source.types.js';
import { limitFromCtx } from './helpers.js';

function traktItemToLite(traktId: number | null, mediaType: 'movie' | 'show', ids: { tmdb?: number | null; imdb?: string | null; tvdb?: number | null }): HomeWriteItemLite | null {
  const providerRefs: Array<{ provider: ListSourceProvider; providerId: string }> = [];
  if (typeof ids.tmdb === 'number') providerRefs.push({ provider: 'tmdb', providerId: String(ids.tmdb) });
  if (typeof ids.tvdb === 'number') providerRefs.push({ provider: 'tvdb', providerId: String(ids.tvdb) });
  if (typeof ids.imdb === 'string') providerRefs.push({ provider: 'imdb', providerId: ids.imdb });
  if (providerRefs.length === 0 && traktId != null) {
    providerRefs.push({ provider: 'trakt', providerId: String(traktId) });
  }
  if (providerRefs.length === 0) return null;
  return {
    type: mediaType === 'show' ? 'tv' : 'movie',
    providerRefs,
  };
}

type MediaTypeConfig = { mediaType: 'movie' | 'tv'; limit?: number };

const MEDIA_TYPE_OPTIONS = [
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV' },
];

export class TraktTrendingSource implements ListSource<MediaTypeConfig> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.trending',
      name: 'Trakt Trending',
      description: 'Titles trending on Trakt right now.',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
      configFields: [
        { key: 'mediaType', label: 'Media type', type: 'select', required: true, default: 'movie', options: MEDIA_TYPE_OPTIONS },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'trending-movie', label: 'Trending Movies', sourceConfig: { mediaType: 'movie' } },
        { id: 'trending-show', label: 'Trending Shows', sourceConfig: { mediaType: 'tv' } },
      ],
    };
  }

  suggestListKey(config: MediaTypeConfig): string {
    return `trakt-trending-${config.mediaType}`;
  }

  async fetchItems(config: MediaTypeConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const traktMediaType = config.mediaType === 'tv' ? 'show' : 'movie';
    const items = await this.trakt.fetchTrending(traktMediaType, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: items.length },
    };
  }
}

export class TraktPopularSource implements ListSource<MediaTypeConfig> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.popular',
      name: 'Trakt Popular',
      description: 'Popular titles on Trakt.',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
      configFields: [
        { key: 'mediaType', label: 'Media type', type: 'select', required: true, default: 'movie', options: MEDIA_TYPE_OPTIONS },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'popular-movie', label: 'Popular Movies', sourceConfig: { mediaType: 'movie' } },
        { id: 'popular-show', label: 'Popular Shows', sourceConfig: { mediaType: 'tv' } },
      ],
    };
  }

  suggestListKey(config: MediaTypeConfig): string {
    return `trakt-popular-${config.mediaType}`;
  }

  async fetchItems(config: MediaTypeConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const traktMediaType = config.mediaType === 'tv' ? 'show' : 'movie';
    const items = await this.trakt.fetchPopular(traktMediaType, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: items.length },
    };
  }
}

export class TraktAnticipatedSource implements ListSource<MediaTypeConfig> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.anticipated',
      name: 'Trakt Most Anticipated',
      description: 'Most anticipated titles on Trakt.',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
      configFields: [
        { key: 'mediaType', label: 'Media type', type: 'select', required: true, default: 'movie', options: MEDIA_TYPE_OPTIONS },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'anticipated-movie', label: 'Most Anticipated Movies', sourceConfig: { mediaType: 'movie' } },
        { id: 'anticipated-show', label: 'Most Anticipated Shows', sourceConfig: { mediaType: 'tv' } },
      ],
    };
  }

  suggestListKey(config: MediaTypeConfig): string {
    return `trakt-anticipated-${config.mediaType}`;
  }

  async fetchItems(config: MediaTypeConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const traktMediaType = config.mediaType === 'tv' ? 'show' : 'movie';
    const items = await this.trakt.fetchAnticipated(traktMediaType, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: items.length },
    };
  }
}

export class TraktNewReleasesSource implements ListSource<{ limit?: number; days?: number }> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.new-releases',
      name: 'Trakt New Releases',
      description: 'Titles recently updated on Trakt (new releases).',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
      configFields: [
        { key: 'days', label: 'Lookback days', type: 'number', required: false, default: 1 },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'new-releases', label: 'New This Week', sourceConfig: { days: 7 } },
        { id: 'new-today', label: 'New Today', sourceConfig: { days: 1 } },
      ],
    };
  }

  suggestListKey(config: { limit?: number; days?: number }): string {
    return `trakt-new-releases-${config.days ?? 1}d`;
  }

  async fetchItems(config: { limit?: number; days?: number }, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const days = Math.max(1, Math.min(config.days ?? 1, 30));
    const date = new Date();
    date.setDate(date.getDate() - days);
    const dateISO = date.toISOString().slice(0, 10);
    const items = await this.trakt.fetchUpdates('movie', dateISO, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: items.length },
    };
  }
}

export class TraktCalendarSource implements ListSource<{ days?: number; limit?: number }> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.calendar-shows',
      name: 'Trakt TV Calendar',
      description: 'TV shows airing this week.',
      mediaTypes: ['tv'],
      requiresProvider: 'trakt',
      configFields: [
        { key: 'days', label: 'Days ahead', type: 'number', required: false, default: 7 },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'airing-week', label: 'Airing This Week', sourceConfig: { days: 7 } },
      ],
    };
  }

  suggestListKey(config: { days?: number; limit?: number }): string {
    return `trakt-calendar-${config.days ?? 7}d`;
  }

  async fetchItems(config: { days?: number; limit?: number }, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const days = Math.max(1, Math.min(config.days ?? 7, 30));
    const dateISO = new Date().toISOString().slice(0, 10);
    const items = await this.trakt.fetchCalendarShows(dateISO, days, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: items.length },
    };
  }
}

export class TraktPopularByRegionSource implements ListSource<MediaTypeConfig> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.popular-by-region',
      name: 'Popular in Your Region',
      description: 'Popular titles filtered by the profile region.',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
      configFields: [
        { key: 'mediaType', label: 'Media type', type: 'select', required: true, default: 'movie', options: MEDIA_TYPE_OPTIONS },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'popular-region-movie', label: 'Popular in Your Region (Movies)', sourceConfig: { mediaType: 'movie' } },
        { id: 'popular-region-show', label: 'Popular in Your Region (Shows)', sourceConfig: { mediaType: 'tv' } },
      ],
    };
  }

  suggestListKey(config: MediaTypeConfig): string {
    return `trakt-popular-region-${config.mediaType}`;
  }

  async fetchItems(config: MediaTypeConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const traktMediaType = config.mediaType === 'tv' ? 'show' : 'movie';
    const items = await this.trakt.fetchPopular(traktMediaType, limitFromCtx(ctx, config.limit ?? 40), { countries: ctx.region ?? undefined });
    return {
      items: items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: items.length },
    };
  }
}

type PublicListConfig = { listUrl?: string; userSlug?: string; listSlug?: string; mediaType?: 'movie' | 'tv' | ''; limit?: number };

/** Parse a Trakt list URL like https://trakt.tv/users/foo/lists/bar into slugs. */
export function parseTraktListUrl(url: string): { userSlug: string; listSlug: string } | null {
  const match = url.match(/trakt\.tv\/users\/([^/]+)\/lists\/([^/?#]+)/i);
  if (!match || !match[1] || !match[2]) return null;
  return { userSlug: decodeURIComponent(match[1]), listSlug: decodeURIComponent(match[2]) };
}

export class TraktPublicListSource implements ListSource<PublicListConfig> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.public-list',
      name: 'Trakt Public List (URL)',
      description: 'A public Trakt list by URL (e.g. https://trakt.tv/users/origin14/lists/director-christopher-nolan).',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
      configFields: [
        { key: 'listUrl', label: 'Trakt list URL', type: 'text', required: true, placeholder: 'https://trakt.tv/users/origin14/lists/director-christopher-nolan' },
        { key: 'mediaType', label: 'Media type filter', type: 'select', required: false, default: '', options: [
          { value: '', label: 'Both' },
          { value: 'movie', label: 'Movies' },
          { value: 'tv', label: 'TV' },
        ] },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
      presets: [
        { id: 'nolan', label: 'Director: Christopher Nolan', sourceConfig: { listUrl: 'https://trakt.tv/users/origin14/lists/director-christopher-nolan' } },
        { id: 'custom-url', label: 'Custom URL (paste below)', sourceConfig: {} },
      ],
    };
  }

  suggestListKey(config: PublicListConfig): string {
    if (config.listUrl) {
      const parsed = parseTraktListUrl(config.listUrl);
      if (parsed) return `trakt-list-${parsed.userSlug}-${parsed.listSlug}`;
    }
    if (config.userSlug && config.listSlug) return `trakt-list-${config.userSlug}-${config.listSlug}`;
    return 'trakt-list';
  }

  async fetchItems(config: PublicListConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    let userSlug = String(config.userSlug ?? '').trim();
    let listSlug = String(config.listSlug ?? '').trim();
    const listUrl = String(config.listUrl ?? '').trim();
    if (listUrl) {
      const parsed = parseTraktListUrl(listUrl);
      if (parsed) {
        userSlug = parsed.userSlug;
        listSlug = parsed.listSlug;
      }
    }
    if (!userSlug || !listSlug) {
      return { items: [] };
    }
    const mediaType = config.mediaType === 'movie' || config.mediaType === 'tv' ? config.mediaType : null;
    const result = await this.trakt.fetchPublicList(userSlug, listSlug, mediaType, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: result.items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: result.items.length, name: result.name },
    };
  }
}
