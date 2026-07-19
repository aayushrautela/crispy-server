import { TraktListService } from '../../../integrations/trakt/trakt-list.service.js';
import type { HomeWriteItemLite, ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult, ListSourceProvider } from '../list-source.types.js';
import { limitFromCtx } from './tmdb-helpers.js';

function traktItemToLite(traktId: number | null, mediaType: 'movie' | 'show', ids: { tmdb?: number | null; imdb?: string | null; tvdb?: number | null }, reason: string, reasonCodes: string[]): HomeWriteItemLite | null {
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
    reason,
    reasonCodes,
  };
}

type Config = { mediaType: 'movie' | 'tv'; limit?: number };

export class TraktTrendingSource implements ListSource<Config> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.trending',
      name: 'Trakt Trending',
      description: 'Titles trending on Trakt.',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
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
    const traktMediaType = config.mediaType === 'tv' ? 'show' : 'movie';
    const items = await this.trakt.fetchTrending(traktMediaType, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids, 'Trending on Trakt', ['trakt-trending']))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: items.length },
    };
  }
}

export class TraktPopularSource implements ListSource<Config> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.popular',
      name: 'Trakt Popular',
      description: 'Popular titles on Trakt.',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
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
    const traktMediaType = config.mediaType === 'tv' ? 'show' : 'movie';
    const items = await this.trakt.fetchPopular(traktMediaType, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids, 'Popular on Trakt', ['trakt-popular']))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: items.length },
    };
  }
}

type PublicListConfig = { userSlug: string; listSlug: string; mediaType?: 'movie' | 'tv'; limit?: number };

export class TraktPublicListSource implements ListSource<PublicListConfig> {
  constructor(private readonly trakt = new TraktListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'trakt.public-list',
      name: 'Trakt Public List',
      description: 'A public Trakt list by user slug and list slug (e.g. https://trakt.tv/users/foo/lists/best-sci-fi).',
      mediaTypes: ['movie', 'tv'],
      requiresProvider: 'trakt',
      configFields: [
        { key: 'userSlug', label: 'User slug', type: 'text', required: true },
        { key: 'listSlug', label: 'List slug', type: 'text', required: true },
        { key: 'mediaType', label: 'Media type filter', type: 'select', required: false, default: '', options: [
          { value: '', label: 'Both' },
          { value: 'movie', label: 'Movies' },
          { value: 'tv', label: 'TV' },
        ] },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
    };
  }

  async fetchItems(config: PublicListConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const userSlug = String(config.userSlug).trim();
    const listSlug = String(config.listSlug).trim();
    if (!userSlug || !listSlug) {
      return { items: [] };
    }
    const mediaType = config.mediaType === 'movie' || config.mediaType === 'tv' ? config.mediaType : null;
    const result = await this.trakt.fetchPublicList(userSlug, listSlug, mediaType, limitFromCtx(ctx, config.limit ?? 40));
    return {
      items: result.items
        .map((it) => traktItemToLite(it.traktId, it.mediaType, it.ids, 'Trakt list', ['trakt-list']))
        .filter((it): it is HomeWriteItemLite => it !== null),
      meta: { sourceCount: result.items.length, name: result.name },
    };
  }
}
