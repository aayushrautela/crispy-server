import { HttpError } from '../../../lib/errors.js';
import { TvdbClient } from './tvdb.client.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export class TvdbRemoteIdResolverService {
  constructor(private readonly tvdbClient = new TvdbClient()) {}

  async resolveSeriesId(remoteId: string): Promise<string | null> {
    const normalized = remoteId.trim();
    if (!normalized) {
      return null;
    }

    const payload = await this.tvdbClient.searchByRemoteId(normalized).catch((error) => {
      if (error instanceof HttpError && error.statusCode === 404) {
        return { data: [] };
      }
      throw error;
    });

    for (const entry of asArray(payload.data)) {
      const series = asRecord(asRecord(entry)?.series);
      const seriesId = asInteger(series?.id) ?? asString(series?.id);
      if (seriesId) {
        return String(seriesId);
      }
    }

    return null;
  }
}
