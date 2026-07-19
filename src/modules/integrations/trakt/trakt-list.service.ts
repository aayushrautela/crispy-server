import { env } from '../../../config/env.js';
import { HttpError } from '../../../lib/errors.js';
import type { ListMediaType } from '../../home/list-sources/list-source.types.js';

type TraktItem = {
  mediaType: 'movie' | 'show';
  traktId: number | null;
  title: string | null;
  ids: { tmdb?: number | null; imdb?: string | null; tvdb?: number | null };
  popularity?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class TraktListService {
  private readonly baseUrl = 'https://api.trakt.tv';

  isConfigured(): boolean {
    return Boolean(env.traktImportClientId);
  }

  private buildHeaders(): Record<string, string> {
    if (!env.traktImportClientId) {
      throw new HttpError(503, 'Trakt is not configured.');
    }
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'trakt-api-key': env.traktImportClientId,
      'trakt-api-version': '2',
      'User-Agent': 'CrispyServer/1.0',
    };
  }

  private mapItem(raw: Record<string, unknown>, mediaType: 'movie' | 'show'): TraktItem | null {
    const movieOrShow = asRecord(raw[mediaType]) ?? {};
    const ids = asRecord(movieOrShow.ids) ?? {};
    const traktId = asNumber(ids.trakt);
    const title = asString(movieOrShow.title) ?? asString(movieOrShow.name);
    if (!title) return null;
    return {
      mediaType,
      traktId,
      title,
      ids: {
        tmdb: asNumber(ids.tmdb),
        imdb: asString(ids.imdb),
        tvdb: asNumber(ids.tvdb),
      },
      popularity: asNumber(raw.popularity),
    };
  }

  private async fetchArray(pathname: string, query: Record<string, string | number | undefined> = {}): Promise<Record<string, unknown>[]> {
    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, { headers: this.buildHeaders() });
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new HttpError(response.status, `Trakt request failed for ${pathname}`);
    }
    const payload = await response.json().catch(() => null);
    return Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [];
  }

  private async fetchList(pathname: string, mediaType: 'movie' | 'show', limit: number): Promise<TraktItem[]> {
    const raw = await this.fetchArray(pathname, { limit, extended: 'full' });
    return raw
      .map((entry) => this.mapItem(entry, mediaType))
      .filter((item): item is TraktItem => item !== null)
      .slice(0, limit);
  }

  async fetchTrending(mediaType: 'movie' | 'show', limit = 50): Promise<TraktItem[]> {
    if (!this.isConfigured()) return [];
    return this.fetchList(`/${mediaType}/trending`, mediaType, limit);
  }

  async fetchPopular(mediaType: 'movie' | 'show', limit = 50): Promise<TraktItem[]> {
    if (!this.isConfigured()) return [];
    return this.fetchList(`/${mediaType}/popular`, mediaType, limit);
  }

  /** Fetch a public Trakt list by user slug + list slug. */
  async fetchPublicList(userSlug: string, listSlug: string, mediaType: ListMediaType | null = null, limit = 100): Promise<{ name: string; items: TraktItem[] }> {
    if (!this.isConfigured()) {
      return { name: listSlug, items: [] };
    }
    const raw = await this.fetchArray(`/users/${encodeURIComponent(userSlug)}/lists/${encodeURIComponent(listSlug)}/items`, { limit, extended: 'full' });
    const items: TraktItem[] = [];
    for (const entry of raw) {
      const type = entry.type === 'show' ? 'show' : 'movie';
      if (mediaType && type !== mediaType) continue;
      const mapped = this.mapItem(entry, type);
      if (mapped) items.push(mapped);
    }
    return { name: listSlug, items: items.slice(0, limit) };
  }
}
