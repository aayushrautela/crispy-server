import type { TmdbTitleRecord } from '../../../metadata/providers/tmdb.types.js';
import type { HomeWriteItemLite, ListSourceCtx, ListSourceResult } from '../list-source.types.js';

export function tmdbRecordToItem(record: TmdbTitleRecord, reason: string, reasonCodes: string[], score?: number | null): HomeWriteItemLite {
  return {
    type: record.mediaType === 'tv' ? 'tv' : 'movie',
    providerRefs: [{ provider: 'tmdb', providerId: String(record.tmdbId) }],
    score: typeof score === 'number' ? score : (typeof record.raw?.popularity === 'number' ? record.raw.popularity : null),
    reason,
    reasonCodes,
    metadata: { tmdbPopularity: record.raw?.popularity ?? null },
  };
}

export function resultFromRecords(records: TmdbTitleRecord[], reason: string, reasonCodes: string[], limit: number): ListSourceResult {
  return {
    items: records.slice(0, limit).map((r) => tmdbRecordToItem(r, reason, reasonCodes)),
    meta: { sourceCount: records.length },
  };
}

export function limitFromCtx(ctx: ListSourceCtx, defaultLimit: number): number {
  return Math.min(ctx.limit || defaultLimit, 100);
}
