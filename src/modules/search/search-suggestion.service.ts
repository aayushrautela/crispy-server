import { appConfig } from '../../config/app-config.js';
import { withDbClient, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { SearchSuggestionCollector } from './search-suggestion.collectors.js';
import { rankSuggestions, type SuggestionSource } from './search-suggestion.ranking.js';
import {
  findSuggestions,
  getSuggestionRefresh,
  listSuggestionRefreshes,
  replaceSuggestionSource,
  type SuggestionRefreshRecord,
} from './search-suggestion.repo.js';

export type SuggestionMatch = {
  name: string;
  source: SuggestionSource;
};

export type RefreshOutcome = {
  source: SuggestionSource;
  entryCount: number;
  upstreamUpdatedAt: string | null;
  skipped: boolean;
  reason?: string;
};

/** Widest candidate window fetched per query; the ranker trims it to `limit`. */
const CANDIDATE_MULTIPLIER = 8;
const CANDIDATE_FLOOR = 200;
const CANDIDATE_CEILING = 1000;
const MAX_QUERY_LENGTH = 100;

export class SearchSuggestionService {
  private readonly collector = new SearchSuggestionCollector();

  async suggest(rawQuery: string, limit: number): Promise<SuggestionMatch[]> {
    const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
    if (!query || limit <= 0) {
      return [];
    }
    const candidateLimit = Math.min(
      Math.max(limit * CANDIDATE_MULTIPLIER, CANDIDATE_FLOOR),
      CANDIDATE_CEILING,
    );

    return withDbClient(async (client) => {
      const rows = await findSuggestions(client, query, candidateLimit);
      return rankSuggestions(rows, query, limit);
    });
  }

  async listRefreshes(): Promise<SuggestionRefreshRecord[]> {
    return withDbClient((client) => listSuggestionRefreshes(client));
  }

  /**
   * Replace one source's rows. `skipWhenUnchanged` is what makes an admin
   * double-tap cheap: classics re-reads the upstream `updated` stamp first and
   * returns without spending a single page fetch when nothing changed.
   */
  async refresh(source: SuggestionSource, options: { actor: string; skipWhenUnchanged?: boolean }): Promise<RefreshOutcome> {
    // Only classics publishes an upstream stamp, so it is the only source whose
    // refresh can be skipped without spending a single page fetch.
    let classicsUpstreamStamp: string | null = null;
    if (source === 'classics') {
      classicsUpstreamStamp = await this.collector.readClassicsUpstreamStamp();
      if (options.skipWhenUnchanged) {
        const existing = await withDbClient((client) => getSuggestionRefresh(client, source));
        if (classicsUpstreamStamp && existing?.upstreamUpdatedAt === classicsUpstreamStamp) {
          return {
            source,
            entryCount: existing.entryCount,
            upstreamUpdatedAt: classicsUpstreamStamp,
            skipped: true,
            reason: 'Upstream list unchanged.',
          };
        }
      }
    }

    const collected = await this.collector.collect(source, { classicsUpstreamStamp });
    if (collected.entries.length === 0) {
      // Refuse to blank a working list because an upstream call misbehaved.
      throw new HttpError(502, `Suggestion refresh for "${source}" produced no entries; keeping the previous set.`);
    }

    const entryCount = await withDbClient((client) => replaceSuggestionSource(client, {
      source,
      entries: collected.entries,
      upstreamUpdatedAt: collected.upstreamUpdatedAt,
      refreshedBy: options.actor,
    }));

    return {
      source,
      entryCount,
      upstreamUpdatedAt: collected.upstreamUpdatedAt,
      skipped: false,
    };
  }

  /** Reject a refresh that would re-spend upstream quota moments after the last one. */
  async assertRefreshAllowed(source: SuggestionSource, client: DbClient): Promise<void> {
    const cooldownMinutes = appConfig.metadata.searchSuggestions.refreshCooldownMinutes;
    if (!(cooldownMinutes > 0)) {
      return;
    }
    const existing = await getSuggestionRefresh(client, source);
    if (!existing) {
      return;
    }
    const elapsedMs = Date.now() - new Date(existing.refreshedAt).getTime();
    const cooldownMs = cooldownMinutes * 60_000;
    if (elapsedMs < cooldownMs) {
      const waitMinutes = Math.ceil((cooldownMs - elapsedMs) / 60_000);
      throw new HttpError(429, `"${source}" was refreshed ${waitMinutes} minute(s) ago; cooldown is ${cooldownMinutes}.`);
    }
  }
}
