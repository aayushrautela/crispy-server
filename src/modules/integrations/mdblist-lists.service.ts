import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { MdbListClient } from './mdblist.client.js';

export type MdbListListItemRef = {
  mediaType: 'movie' | 'show';
  tmdbId: number | null;
  imdbId: string | null;
  tvdbId: number | null;
  title: string | null;
};

export type MdbListListInfoRef = {
  name: string | null;
  description: string | null;
  mediatype: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeMediaType(value: unknown): 'movie' | 'show' | null {
  if (value === 'movie' || value === 'movies') return 'movie';
  if (value === 'show' || value === 'shows' || value === 'series' || value === 'tv') return 'show';
  return null;
}

function nestedId(ids: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = ids[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/**
 * Normalize a raw MDBList list-item entry into provider refs. Entries surfaced
 * by different endpoints carry their ids either at the top level (imdb_id,
 * tvdb_id, id) or in a nested `ids` object — accept both.
 */
export function mapMdblistListItem(
  raw: Record<string, unknown>,
  fallbackMediaType: 'movie' | 'show' | null = null,
): MdbListListItemRef | null {
  const ids = asRecord(raw.ids) ?? {};

  const tmdbId = asNumber(nestedId(ids, ['tmdb', 'tmdbid'])) ?? asNumber(raw.id);
  const imdbId = asString(nestedId(ids, ['imdb', 'imdbid'])) ?? asString(raw.imdb_id);
  const tvdbId = asNumber(nestedId(ids, ['tvdb', 'tvdbid'])) ?? asNumber(raw.tvdb_id);

  if (tmdbId === null && imdbId === null && tvdbId === null) return null;

  const mediaType = normalizeMediaType(raw.mediatype) ?? fallbackMediaType;
  if (!mediaType) return null;

  return {
    mediaType,
    tmdbId,
    imdbId,
    tvdbId,
    title: asString(raw.title),
  };
}

export class MdbListListService {
  constructor(private readonly client = new MdbListClient()) {}

  isConfigured(): boolean {
    return Boolean(env.mdblistApiKey);
  }

  private getApiKey(): string {
    if (!this.isConfigured()) {
      throw new HttpError(503, 'MDBList is not configured.');
    }
    return env.mdblistApiKey;
  }

  /** List metadata (name, description, media type) or null when not found. */
  async fetchListInfo(username: string, slug: string): Promise<MdbListListInfoRef | null> {
    try {
      const payload = await this.client.fetchList(username, slug, this.getApiKey());
      const info = asRecord(Array.isArray(payload) ? payload[0] : payload);
      if (!info) return null;
      return {
        name: asString(info.name),
        description: asString(info.description),
        mediatype: asString(info.mediatype),
      };
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) return null;
      throw error;
    }
  }

  /**
   * List items, optionally narrowed to one media type. A missing/private list
   * yields an empty result. Item order follows the list's own ranking.
   */
  async fetchListItems(
    username: string,
    slug: string,
    options?: { mediaTypeFilter?: 'movie' | 'show' | null; limit?: number },
  ): Promise<MdbListListItemRef[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 100, 100));
    try {
      const rawItems = await this.client.fetchListItems(username, slug, this.getApiKey(), {
        mediaType: options?.mediaTypeFilter ?? null,
        limit,
      });
      return rawItems
        .map((item) => mapMdblistListItem(item, options?.mediaTypeFilter ?? null))
        .filter((item): item is MdbListListItemRef => item !== null)
        .slice(0, limit);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) return [];
      throw error;
    }
  }
}