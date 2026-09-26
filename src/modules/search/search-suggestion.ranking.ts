/**
 * Ranking for curated search suggestions. Pure and synchronous: no clock, no
 * IO, no randomness, so the ordering the endpoint returns is fully determined
 * by the rows and the query.
 */

export type SuggestionSource = 'trending' | 'popular' | 'classics';

export const SUGGESTION_SOURCES = ['trending', 'popular', 'classics'] as const satisfies readonly SuggestionSource[];

export function isSuggestionSource(value: string): value is SuggestionSource {
  return (SUGGESTION_SOURCES as readonly string[]).includes(value);
}

/** Earlier sources win when a name appears in more than one. */
const SOURCE_PRIORITY: Record<SuggestionSource, number> = {
  trending: 0,
  popular: 1,
  classics: 2,
};

export type SuggestionRow = {
  source: SuggestionSource;
  name: string;
  normalizedName: string;
  rank: number;
};

export type RankedSuggestion = {
  name: string;
  source: SuggestionSource;
};

/**
 * Lowercase, drop accents, and turn every other separator run into a single
 * space. The mark pass strips `\p{M}` rather than `\p{Diacritic}` on purpose:
 * NFKD decomposes "é" into "e" + U+0301, but U+00B7 (·) is a spacing
 * punctuation mark that is *also* Diacritic-class, so stripping Diacritic
 * would delete it outright and glue words together ("Bang·Bang" -> "bangbang")
 * instead of separating them.
 */
export function normalizeSuggestionName(value: string): string {
  const decomposed = value.normalize('NFKD').replace(/\p{M}+/gu, '');
  return decomposed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Only exact and prefix tiers exist, because the query behind this is a
 * prefix `LIKE` served by `private.search_suggestions_normalized_prefix_idx`.
 * A substring tier here would be unreachable, and substring matching would also
 * force a sequential scan for no gain: "the" already prefix-matches "the
 * matrix" and "the godfather", which is the word-prefix behaviour we want.
 */
type MatchTier = 'exact' | 'prefix';

function matchTier(normalizedName: string, normalizedQuery: string): MatchTier | null {
  if (normalizedName === normalizedQuery) {
    return 'exact';
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    return 'prefix';
  }
  return null;
}

const TIER_ORDER: Record<MatchTier, number> = {
  exact: 0,
  prefix: 1,
};

/**
 * Order suggestions for a query. Exact matches beat prefix matches; ties fall
 * back to source priority, then the curated rank, then the name so the result
 * is stable across equal rows.
 */
export function rankSuggestions(rows: SuggestionRow[], rawQuery: string, limit: number): RankedSuggestion[] {
  const normalizedQuery = normalizeSuggestionName(rawQuery);
  if (!normalizedQuery || limit <= 0) {
    return [];
  }

  const scored: Array<{
    tier: number;
    source: number;
    rank: number;
    key: string;
    display: string;
    sourceName: SuggestionSource;
  }> = [];
  for (const row of rows) {
    const tier = matchTier(row.normalizedName, normalizedQuery);
    if (tier === null) {
      continue;
    }
    scored.push({
      tier: TIER_ORDER[tier],
      source: SOURCE_PRIORITY[row.source],
      rank: row.rank,
      key: row.normalizedName,
      display: row.name,
      sourceName: row.source,
    });
  }

  scored.sort((left, right) => (
    left.tier - right.tier
    || left.source - right.source
    || left.rank - right.rank
    || left.key.localeCompare(right.key)
  ));

  const seen = new Set<string>();
  const ranked: RankedSuggestion[] = [];
  for (const entry of scored) {
    if (seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    ranked.push({ name: entry.display, source: entry.sourceName });
    if (ranked.length >= limit) {
      break;
    }
  }
  return ranked;
}
