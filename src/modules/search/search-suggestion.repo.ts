import type { QueryResult } from 'pg';
import type { DbClient } from '../../lib/db.js';
import type { SuggestionRow, SuggestionSource } from './search-suggestion.ranking.js';

type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

export type SuggestionRefreshRecord = {
  source: SuggestionSource;
  entryCount: number;
  upstreamUpdatedAt: string | null;
  refreshedAt: Date;
  refreshedBy: string | null;
};

type SuggestionDbRow = {
  source: SuggestionSource;
  name: string;
  normalized_name: string;
  rank: number;
};

type RefreshDbRow = {
  source: SuggestionSource;
  entry_count: number;
  upstream_updated_at: string | null;
  refreshed_at: Date;
  refreshed_by: string | null;
};

export type RefreshSuggestionSourceInput = {
  source: SuggestionSource;
  entries: Array<{ name: string; normalizedName: string; rank: number }>;
  upstreamUpdatedAt: string | null;
  refreshedBy: string | null;
};

export async function findSuggestions(
  client: Queryable,
  normalizedQuery: string,
  candidateLimit: number,
): Promise<SuggestionRow[]> {
  if (!normalizedQuery || candidateLimit <= 0) {
    return [];
  }
  // The endpoint ranks in memory, so fetch a wider candidate window than the
  // caller needs and let exact/prefix ordering pick the winners.
  const result = await client.query(
    `SELECT source, name, normalized_name, rank
       FROM private.search_suggestions
      WHERE normalized_name LIKE $1
      ORDER BY rank ASC
      LIMIT $2`,
    [`${escapeLikePattern(normalizedQuery)}%`, candidateLimit],
  );

  return (result.rows as SuggestionDbRow[]).map((row) => ({
    source: row.source,
    name: row.name,
    normalizedName: row.normalized_name,
    rank: row.rank,
  }));
}

export async function listSuggestionRefreshes(client: Queryable): Promise<SuggestionRefreshRecord[]> {
  const result = await client.query(
    `SELECT source, entry_count, upstream_updated_at, refreshed_at, refreshed_by
       FROM private.search_suggestion_refreshes
      ORDER BY source ASC`,
  );

  return (result.rows as RefreshDbRow[]).map((row) => ({
    source: row.source,
    entryCount: row.entry_count,
    upstreamUpdatedAt: row.upstream_updated_at,
    refreshedAt: row.refreshed_at,
    refreshedBy: row.refreshed_by,
  }));
}

export async function getSuggestionRefresh(
  client: Queryable,
  source: SuggestionSource,
): Promise<SuggestionRefreshRecord | null> {
  const result = await client.query(
    `SELECT source, entry_count, upstream_updated_at, refreshed_at, refreshed_by
       FROM private.search_suggestion_refreshes
      WHERE source = $1`,
    [source],
  );
  const row = (result.rows as RefreshDbRow[])[0];
  if (!row) {
    return null;
  }
  return {
    source: row.source,
    entryCount: row.entry_count,
    upstreamUpdatedAt: row.upstream_updated_at,
    refreshedAt: row.refreshed_at,
    refreshedBy: row.refreshed_by,
  };
}

/**
 * Replace every row for one source in a single transaction, so a refresh that
 * fails upstream leaves the previous set served rather than emptying the list.
 */
export async function replaceSuggestionSource(
  client: DbClient,
  input: RefreshSuggestionSourceInput,
): Promise<number> {
  await client.query('BEGIN');
  try {
    await client.query('DELETE FROM private.search_suggestions WHERE source = $1', [input.source]);

    for (const entry of input.entries) {
      await client.query(
        `INSERT INTO private.search_suggestions (source, name, normalized_name, rank)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source, normalized_name) DO UPDATE
           SET name = EXCLUDED.name, rank = EXCLUDED.rank, refreshed_at = now()`,
        [input.source, entry.name, entry.normalizedName, entry.rank],
      );
    }

    await client.query(
      `INSERT INTO private.search_suggestion_refreshes
         (source, entry_count, upstream_updated_at, refreshed_at, refreshed_by)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (source) DO UPDATE
         SET entry_count = EXCLUDED.entry_count,
             upstream_updated_at = EXCLUDED.upstream_updated_at,
             refreshed_at = now(),
             refreshed_by = EXCLUDED.refreshed_by`,
      [input.source, input.entries.length, input.upstreamUpdatedAt, input.refreshedBy],
    );

    await client.query('COMMIT');
    return input.entries.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
