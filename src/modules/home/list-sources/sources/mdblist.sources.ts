import { MdbListListService } from '../../../integrations/mdblist-lists.service.js';
import type { HomeWriteItemLite, ListSource, ListSourceCtx, ListSourceDescriptor, ListSourceResult, ListSourceProvider } from '../list-source.types.js';
import { limitFromCtx } from './helpers.js';

type MediaTypeOptions = Array<{ value: string; label: string }>;

const MEDIA_TYPE_OPTIONS: MediaTypeOptions = [
  { value: '', label: 'Both' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV' },
];

type PublicListConfig = { listUrl?: string; mediaType?: 'movie' | 'tv' | ''; limit?: number };

/** Parse an MDBList list URL like https://mdblist.com/lists/<user>/<list> (trailing /json tolerated). */
export function parseMdblistListUrl(url: string): { username: string; listname: string } | null {
  const match = url.match(/mdblist\.com\/lists\/([^/]+)\/([^/?#]+)/i);
  if (!match?.[1] || !match?.[2]) return null;
  return { username: decodeURIComponent(match[1]), listname: decodeURIComponent(match[2]) };
}

function mdblistItemToLite(
  tmdbId: number | null,
  imdbId: string | null,
  tvdbId: number | null,
  mediaType: 'movie' | 'show',
): HomeWriteItemLite | null {
  const providerRefs: Array<{ provider: ListSourceProvider; providerId: string }> = [];
  if (tmdbId != null) providerRefs.push({ provider: 'tmdb', providerId: String(tmdbId) });
  if (tvdbId != null) providerRefs.push({ provider: 'tvdb', providerId: String(tvdbId) });
  if (imdbId) providerRefs.push({ provider: 'imdb', providerId: imdbId });
  if (providerRefs.length === 0) return null;
  return {
    type: mediaType === 'show' ? 'tv' : 'movie',
    providerRefs,
  };
}

export class MdbListPublicListSource implements ListSource<PublicListConfig> {
  constructor(private readonly mdblist = new MdbListListService()) {}

  descriptor(): ListSourceDescriptor {
    return {
      id: 'mdblist.public-list',
      name: 'MDBList List (URL)',
      description: 'A public MDBList list by URL (https://mdblist.com/lists/<user>/<list>).',
      mediaTypes: ['movie', 'tv'],
      adminCreatable: true,
      configFields: [
        { key: 'listUrl', label: 'MDBList list URL', type: 'text', required: true, placeholder: 'https://mdblist.com/lists/<user>/<list>' },
        { key: 'mediaType', label: 'Media type filter', type: 'select', required: false, default: '', options: MEDIA_TYPE_OPTIONS },
        { key: 'limit', label: 'Max items', type: 'number', required: false, default: 40 },
      ],
    };
  }

  suggestListKey(config: PublicListConfig): string {
    if (config.listUrl) {
      const parsed = parseMdblistListUrl(config.listUrl);
      if (parsed) return `mdblist-list-${parsed.username}-${parsed.listname}`;
    }
    return 'mdblist-list';
  }

  async fetchItems(config: PublicListConfig, ctx: ListSourceCtx): Promise<ListSourceResult> {
    const listUrl = String(config.listUrl ?? '').trim();
    if (!listUrl) return { items: [] };
    const parsed = parseMdblistListUrl(listUrl);
    if (!parsed) return { items: [] };

    const mediaType = config.mediaType === 'movie' || config.mediaType === 'tv' ? config.mediaType : null;
    const mdbMediaType = mediaType === 'tv' ? 'show' : mediaType === 'movie' ? 'movie' : null;
    const limit = limitFromCtx(ctx, config.limit ?? 40);

    const [info, items] = await Promise.all([
      this.mdblist.fetchListInfo(parsed.username, parsed.listname).catch(() => null),
      this.mdblist.fetchListItems(parsed.username, parsed.listname, { mediaTypeFilter: mdbMediaType, limit }),
    ]);

    return {
      items: items
        .map((item) => mdblistItemToLite(item.tmdbId, item.imdbId, item.tvdbId, item.mediaType))
        .filter((item): item is HomeWriteItemLite => item !== null),
      meta: {
        sourceCount: items.length,
        ...(info?.name ? { name: info.name } : {}),
      },
    };
  }
}