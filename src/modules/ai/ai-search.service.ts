import { logger } from '../../config/logger.js';
import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ShortLivedRequestCoalescer } from '../../lib/request-coalescer.js';
import type { AiSearchInternalResult } from '../ai/ai.types.js';
import { toClientMediaCard } from '../metadata/client-media-card.mapper.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';
import { buildMetadataCardView } from '../metadata/metadata-card.builders.js';
import type { MetadataSearchResponse } from '../metadata/metadata-detail.types.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { TitleSearchService } from '../search/title-search.service.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { buildSearchPrompt } from './ai-prompts.js';
import { parseSearchCandidates, type AiSearchCandidate } from './ai-search-candidates.js';

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

const AI_SEARCH_CACHE_TTL_MS = 10_000;
const AI_CANDIDATE_RESOLVE_CONCURRENCY = 3;
const AI_SEARCH_MAX_PER_SECTION = 20;

export class AiSearchService {
  constructor(
    private readonly profileLocalService = new ProfileLocalService(),
    private readonly aiRequestExecutor = new AiRequestExecutor(),
    private readonly titleSearchService = new TitleSearchService(),
    private readonly requestCoalescer = new ShortLivedRequestCoalescer<AiSearchInternalResult>(AI_SEARCH_CACHE_TTL_MS),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async search(userId: string, input: {
    query: string;
    profileId: string;
    locale?: string | null;
  }): Promise<AiSearchInternalResult> {
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
      }, 'AI search completed');

      return { query, locale, candidates: resolved };
    });
  }
}

async function resolveSuggestions(
  titleSearchService: TitleSearchService,
  candidates: AiSearchCandidate[],
  locale: string,
): Promise<AiSearchInternalResult['candidates']> {
  const results = await mapWithConcurrency(
    candidates,
    AI_CANDIDATE_RESOLVE_CONCURRENCY,
    (candidate) => resolveSuggestion(titleSearchService, candidate, locale),
  );
  return results.flat();
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map(mapper)));
  }
  return results;
}

async function resolveSuggestion(
  titleSearchService: TitleSearchService,
  candidate: AiSearchCandidate,
  locale: string,
) {
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

export function buildAiSearchResponse(internal: AiSearchInternalResult): MetadataSearchResponse {
  const movies = [];
  const series = [];
  const seen = new Set<string>();
  for (const c of internal.candidates) {
    if (seen.has(c.contentId) || !c.hydrated) continue;
    seen.add(c.contentId);
    const view = buildMetadataCardView({
      identity: c.identity,
      itemId: encodePublicItemId(c.contentId),
      title: c.hydrated,
      language: internal.locale,
    });
    const card = toClientMediaCard(view, { progress: null });
    if (!hasSearchArtwork(card)) continue;
    if (card.mediaType === 'tv') series.push(card);
    else movies.push(card);
  }
  return {
    query: internal.query,
    movies: movies.slice(0, AI_SEARCH_MAX_PER_SECTION),
    series: series.slice(0, AI_SEARCH_MAX_PER_SECTION),
    people: [],
  };
}

function hasSearchArtwork(card: ClientMediaCard): boolean {
  const artwork = card.images.artwork;
  return Boolean(artwork && (artwork.small || artwork.medium || artwork.large));
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
