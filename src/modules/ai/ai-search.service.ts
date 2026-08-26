import { logger } from '../../config/logger.js';
import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ShortLivedRequestCoalescer } from '../../lib/request-coalescer.js';
import type { MetadataSearchResponse, MetadataSearchResult } from '../metadata/metadata-detail.types.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { TitleSearchService } from '../search/title-search.service.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { buildSearchPrompt } from './ai-prompts.js';
import { parseSearchCandidates, type AiSearchCandidate } from './ai-search-candidates.js';
import type { AiSearchResponse } from './ai.types.js';

const AI_SEARCH_SYSTEM_PROMPT = [
  'You are the backend recommendation engine for a streaming app.',
  'Your ONLY output must be a raw, valid JSON object.',
  '',
  'Strict Rules:',
  'You must start your response with { and end with }.',
  'Do not include markdown formatting, backticks, or conversational text.',
  'Rely entirely on your internal knowledge. Do not attempt to use tools or web search.',
].join('\n');

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

const FINAL_RESULT_LIMIT = 20;
const AI_SEARCH_CACHE_TTL_MS = 10_000;

export class AiSearchService {
  constructor(
    private readonly profileLocalService = new ProfileLocalService(),
    private readonly aiRequestExecutor = new AiRequestExecutor(),
    private readonly titleSearchService = new TitleSearchService(),
    private readonly requestCoalescer = new ShortLivedRequestCoalescer<AiSearchResponse>(AI_SEARCH_CACHE_TTL_MS),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async search(userId: string, input: {
    query: string;
    profileId: string;
    locale?: string | null;
  }): Promise<AiSearchResponse> {
    const query = normalizeString(input.query);
    const profileId = normalizeString(input.profileId);
    const locale = normalizeLocale(input.locale);

    if (!query) {
      throw new HttpError(400, 'Query is required.');
    }
    if (!profileId) {
      throw new HttpError(400, 'Profile is required.');
    }

    const requestKey = [userId, profileId, query, locale].join('|');

    return this.requestCoalescer.run(requestKey, async () => {
      await this.profileLocalService.requireOwnedProfile(userId, profileId);
      const { payload: generated, request } = await this.aiRequestExecutor.generateJsonForUser({
        userId,
        feature: 'search',
        systemPrompt: AI_SEARCH_SYSTEM_PROMPT,
        userPrompt: buildSearchPrompt(query, locale),
      });

      const rawItems = Array.isArray(generated.items) ? generated.items : [];
      const candidates = parseSearchCandidates(rawItems);
      const resolved = await resolveSuggestions(this.titleSearchService, candidates, locale);
      const response = bucketResolvedItems(query, dedupeResolvedItems(resolved), FINAL_RESULT_LIMIT);

      logger.info({
        userId,
        profileId,
        query: sampleQuery(query),
        locale,
        providerId: request.providerId,
        model: request.model,
        rawItemCount: rawItems.length,
        candidateCount: candidates.length,
        resolvedCount: resolved.length,
        finalCount: response.movies.length + response.series.length,
      }, 'AI search completed');

      return response;
    });
  }
}

async function resolveSuggestions(
  titleSearchService: TitleSearchService,
  candidates: AiSearchCandidate[],
  locale: string,
): Promise<MetadataSearchResult[]> {
  const results: MetadataSearchResult[] = [];
  for (const candidate of candidates) {
    const items = await resolveSuggestion(titleSearchService, candidate, locale);
    results.push(...items);
  }
  return results;
}

async function resolveSuggestion(
  titleSearchService: TitleSearchService,
  candidate: AiSearchCandidate,
  locale: string,
): Promise<MetadataSearchResult[]> {
  try {
    const tmdbMediaType = candidate.mediaType === 'show' ? 'tv' : candidate.mediaType;
    return await titleSearchService.resolveAiCandidates({
      query: candidate.title,
      mediaType: tmdbMediaType,
      year: candidate.year,
      locale,
    });
  } catch {
    logger.debug({ candidate: candidate.title }, 'Failed to resolve candidate, skipping.');
    return [];
  }
}

function bucketResolvedItems(query: string, items: MetadataSearchResult[], limit: number): MetadataSearchResponse {
  const movies: MetadataSearchResult[] = [];
  const series: MetadataSearchResult[] = [];

  for (const item of items) {
    if (item.mediaType === 'movie') {
      movies.push(item);
      continue;
    }
    if (item.mediaType === 'tv') {
      series.push(item);
      continue;
    }
  }

  return {
    query,
    movies: movies.slice(0, limit),
    series: series.slice(0, limit),
    people: [],
  };
}

function dedupeResolvedItems(items: MetadataSearchResult[]): MetadataSearchResult[] {
  const seen = new Set<string>();
  const result: MetadataSearchResult[] = [];
  for (const item of items) {
    if (seen.has(item.itemId)) {
      continue;
    }
    seen.add(item.itemId);
    result.push(item);
  }
  return result;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLocale(value: unknown): string {
  const normalized = normalizeString(value);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : 'en-US';
}

function sampleQuery(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
