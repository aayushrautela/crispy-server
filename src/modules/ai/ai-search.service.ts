import { logger } from '../../config/logger.js';
import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { CatalogItem } from '../metadata/metadata-card.types.js';
import type { MetadataSearchFilter } from '../metadata/metadata-detail.types.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { TitleSearchService } from '../search/title-search.service.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { buildSearchPrompt, type SearchQueryAnalysis } from './ai-prompts.js';
import { parseSearchCandidates, resolveCandidateFilter, type AiSearchCandidate } from './ai-search-candidates.js';
import type { AiSearchFilter, AiSearchItem, AiSearchResponse } from './ai.types.js';

type ResolvedSuggestion = {
  candidate: AiSearchCandidate;
  item: AiSearchItem;
};

const FINAL_RESULT_LIMIT = 12;
const RESOLUTION_SEARCH_LIMIT = 20;
const MIN_METADATA_MATCH_SCORE = 36;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

export class AiSearchService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly aiRequestExecutor = new AiRequestExecutor(),
    private readonly titleSearchService = new TitleSearchService(),
  ) {}

  async search(userId: string, input: {
    query: string;
    profileId: string;
    filter?: string | null;
    locale?: string | null;
  }): Promise<AiSearchResponse> {
    const query = normalizeString(input.query);
    const profileId = normalizeString(input.profileId);
    const filter = normalizeFilter(input.filter);
    const locale = normalizeLocale(input.locale);
    const analysis = analyzeQuery(query);

    if (!query) {
      throw new HttpError(400, 'Query is required.');
    }
    if (!profileId) {
      throw new HttpError(400, 'Profile is required.');
    }

    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
    });
    const { payload: generated, request } = await this.aiRequestExecutor.generateJsonForUser({
      userId,
      feature: 'search',
      systemPrompt: 'Return compact, valid JSON only. Never include markdown fences. Suggest real released titles that fit the requested catalog scope.',
      userPrompt: buildSearchPrompt(query, filter, locale, analysis),
    });

    const rawItems = Array.isArray(generated.items) ? generated.items : [];
    const candidates = parseSearchCandidates(rawItems);
    const resolvedSuggestions = await resolveSuggestions(this.titleSearchService, candidates, filter, locale);
    const items = finalizeResolvedItems(resolvedSuggestions, analysis);

    logger.info({
      userId,
      profileId,
      query: sampleQuery(query),
      filter,
      locale,
      providerId: request.providerId,
      model: request.model,
      rawItemCount: rawItems.length,
      candidateCount: candidates.length,
      resolvedCount: resolvedSuggestions.length,
      finalCount: items.length,
      candidateSamples: candidates.slice(0, 8),
      unresolvedCandidates: summarizeUnresolvedCandidates(candidates, resolvedSuggestions),
      resultTitles: items.slice(0, 8).map((item) => item.title ?? `${item.mediaType}:${item.provider}:${item.providerId}`),
      generatedKeys: Object.keys(generated).slice(0, 10),
    }, 'AI search completed');

    return { items };
  }
}

async function resolveSuggestions(
  titleSearchService: TitleSearchService,
  candidates: AiSearchCandidate[],
  filter: AiSearchFilter,
  locale: string,
): Promise<ResolvedSuggestion[]> {
  const resolved = await Promise.all(
    candidates.map(async (candidate) => {
      const item = await resolveSuggestion(titleSearchService, candidate, filter, locale);
      return item ? { candidate, item } : null;
    }),
  );
  return resolved.filter((item): item is ResolvedSuggestion => item !== null);
}

async function resolveSuggestion(
  titleSearchService: TitleSearchService,
  candidate: AiSearchCandidate,
  filter: AiSearchFilter,
  locale: string,
): Promise<AiSearchItem | null> {
  const searchFilters = resolveCandidateFilter(filter, candidate.mediaType);
  const queryVariants = buildResolutionQueryVariants(candidate.title);

  for (const candidateFilter of searchFilters) {
    for (const query of queryVariants) {
      const response = await titleSearchService.searchTitles({
        query,
        filter: mapFilterToMetadataFilter(candidateFilter),
        limit: RESOLUTION_SEARCH_LIMIT,
        locale,
      });
      const selected = selectBestMetadataMatch(response.items, candidate.title, candidate.mediaType);
      if (selected) {
        return selected;
      }
    }
  }

  return null;
}

function selectBestMetadataMatch(items: CatalogItem[], title: string, mediaTypeHint: AiSearchCandidate['mediaType']): AiSearchItem | null {
  const normalizedTarget = normalizeTitle(title);
  const sorted = [...items].sort((left, right) => {
    const rightScore = scoreMetadataMatch(right, normalizedTarget, mediaTypeHint);
    const leftScore = scoreMetadataMatch(left, normalizedTarget, mediaTypeHint);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return compareReleaseYears(right.releaseYear, left.releaseYear);
  });
  const best = sorted[0] ?? null;
  if (!best) {
    return null;
  }

  return scoreMetadataMatch(best, normalizedTarget, mediaTypeHint) >= MIN_METADATA_MATCH_SCORE
    ? best
    : null;
}

function scoreMetadataMatch(item: CatalogItem, normalizedTarget: string, mediaTypeHint: AiSearchCandidate['mediaType']): number {
  let score = 0;
  const normalizedTitle = normalizeTitle(item.title ?? '');
  const normalizedSubtitle = normalizeTitle(item.subtitle ?? '');
  if (normalizedTitle === normalizedTarget) {
    score += 120;
  } else if (normalizedTitle.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedTitle)) {
    score += 80;
  } else if (normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle)) {
    score += 40;
  }

  if (normalizedSubtitle) {
    if (normalizedSubtitle === normalizedTarget) {
      score += 60;
    } else if (normalizedSubtitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedSubtitle)) {
      score += 20;
    }
  }

  score += Math.min(sharedTitleTokenCount(normalizedTitle, normalizedTarget) * 12, 36);
  if (matchesMediaTypeHint(item, mediaTypeHint)) {
    score += 30;
  }
  if (item.posterUrl) {
    score += 10;
  }
  if (item.releaseYear) {
    score += 4;
  }
  return score;
}

function matchesMediaTypeHint(item: CatalogItem, mediaTypeHint: AiSearchCandidate['mediaType']): boolean {
  if (!mediaTypeHint) {
    return false;
  }
  return item.mediaType === mediaTypeHint;
}

function finalizeResolvedItems(resolved: ResolvedSuggestion[], analysis: SearchQueryAnalysis): AiSearchItem[] {
  const unique = dedupeResolvedSuggestions(resolved);
  if (!analysis.isRecommendation) {
    return unique.map(({ item }) => item).slice(0, FINAL_RESULT_LIMIT);
  }

  const kept: ResolvedSuggestion[] = [];
  let skippedAnchor = false;
  for (const suggestion of unique) {
    if (!skippedAnchor && matchesAnchorSuggestion(suggestion, analysis.anchorHint)) {
      skippedAnchor = true;
      continue;
    }
    if (kept.some((existing) => isSameTitleFamily(existing.item.title ?? '', suggestion.item.title ?? ''))) {
      continue;
    }
    kept.push(suggestion);
    if (kept.length >= FINAL_RESULT_LIMIT) {
      break;
    }
  }

  return kept.map(({ item }) => item);
}

function dedupeResolvedSuggestions(items: ResolvedSuggestion[]): ResolvedSuggestion[] {
  const seen = new Set<string>();
  const result: ResolvedSuggestion[] = [];
  for (const suggestion of items) {
    const key = `${suggestion.item.mediaType}:${suggestion.item.provider}:${suggestion.item.providerId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(suggestion);
  }
  return result;
}

function analyzeQuery(query: string): SearchQueryAnalysis {
  return {
    isRecommendation: isRecommendationQuery(query),
    anchorHint: extractAnchorHint(query),
  };
}

function isRecommendationQuery(query: string): boolean {
  const normalized = normalizeTitle(query);
  if (!normalized) {
    return false;
  }

  return [
    /\blike\b/,
    /\bsimilar\b/,
    /\bother than\b/,
    /\bmore like\b/,
    /\bsomething like\b/,
    /\banything like\b/,
    /\bif i like\b/,
    /\bif i liked\b/,
    /\brecommend\b/,
    /\bwhat should i watch\b/,
    /\bwhat to watch\b/,
  ].some((pattern) => pattern.test(normalized));
}

function extractAnchorHint(query: string): string | null {
  const quoted = [...query.matchAll(/["“”'`](.+?)["“”'`]/g)]
    .map((match) => cleanAnchorHint(match[1] ?? ''))
    .filter((value): value is string => Boolean(value));
  if (quoted.length > 0) {
    return quoted.sort((left, right) => right.length - left.length)[0] ?? null;
  }

  const patterns = [
    /(?:^|\b)(?:other\s+)?(?:movies?|shows?|series|tv\s+shows?)?\s*(?:like|similar to|more like)\s+(.+)$/i,
    /(?:^|\b)(?:something|anything)\s+like\s+(.+)$/i,
    /(?:^|\b)(?:other than|except)\s+(.+)$/i,
    /(?:^|\b)(?:if i like|if i liked)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    const anchor = cleanAnchorHint(match?.[1] ?? '');
    if (anchor) {
      return anchor;
    }
  }

  return null;
}

function cleanAnchorHint(value: string): string | null {
  const withoutQualifiers = value
    .replace(/[?!.,]+$/g, '')
    .split(/\b(?:but|except|without)\b/i)[0]
    ?.trim() ?? '';
  const cleaned = withoutQualifiers
    .replace(/^(?:movies?|shows?|series|tv\s+shows?)\s+/i, '')
    .trim();
  return cleaned || null;
}

function matchesAnchorSuggestion(suggestion: ResolvedSuggestion, anchorHint: string | null): boolean {
  if (!anchorHint) {
    return false;
  }

  const normalizedAnchor = normalizeTitle(anchorHint);
  if (!normalizedAnchor) {
    return false;
  }

  return titleMatchesAnchor(suggestion.candidate.title, normalizedAnchor)
    || titleMatchesAnchor(suggestion.item.title ?? '', normalizedAnchor);
}

function titleMatchesAnchor(title: string, normalizedAnchor: string): boolean {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    return false;
  }
  if (normalizedTitle === normalizedAnchor) {
    return true;
  }

  const anchorTokens = titleTokens(normalizedAnchor);
  if (anchorTokens.length <= 1) {
    return false;
  }

  const shared = sharedTitleTokenCount(normalizedTitle, normalizedAnchor);
  if (shared >= anchorTokens.length) {
    return true;
  }

  return anchorTokens.length >= 3
    && (normalizedTitle.startsWith(normalizedAnchor) || normalizedAnchor.startsWith(normalizedTitle));
}

export function isSameTitleFamily(leftTitle: string, rightTitle: string): boolean {
  const normalizedLeft = normalizeTitle(leftTitle);
  const normalizedRight = normalizeTitle(rightTitle);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftKey = titleFamilyKey(leftTitle);
  const rightKey = titleFamilyKey(rightTitle);
  if (!leftKey || !rightKey || leftKey !== rightKey) {
    return false;
  }

  if (hasSharedSeriesPrefix(leftTitle, rightTitle)) {
    return true;
  }

  const sharedTokens = sharedTitleTokenCount(normalizedLeft, normalizedRight);
  const shorterTokenCount = Math.min(titleTokens(normalizedLeft).length, titleTokens(normalizedRight).length);
  return shorterTokenCount > 0 && sharedTokens >= shorterTokenCount;
}

function titleFamilyKey(title: string): string | null {
  const prefix = title.split(/[:\-]/, 1)[0] ?? title;
  const tokens = titleTokens(normalizeTitle(prefix)).filter((token) => !TITLE_STOP_WORDS.has(token));
  if (tokens.length === 0) {
    return null;
  }
  return tokens.slice(0, 1).join(' ');
}

export function buildResolutionQueryVariants(title: string): string[] {
  const candidates = [
    title,
    title.replace(/["'`]+/g, ' '),
    title.replace(/[,:;!?]+/g, ' '),
    title.split(':', 1)[0] ?? title,
    title.replace(/\s+\((19|20)\d{2}\)\s*$/g, ''),
  ];

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const value of candidates) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      continue;
    }
    const key = normalizeTitle(normalized);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    queries.push(normalized);
  }
  return queries;
}

function compareReleaseYears(left: number | null, right: number | null): number {
  const leftValue = left ?? -1;
  const rightValue = right ?? -1;
  return leftValue - rightValue;
}

function hasSharedSeriesPrefix(leftTitle: string, rightTitle: string): boolean {
  const leftPrefix = normalizeSeriesPrefix(leftTitle);
  const rightPrefix = normalizeSeriesPrefix(rightTitle);
  if (!leftPrefix || !rightPrefix || leftPrefix !== rightPrefix) {
    return false;
  }

  return titleTokens(leftPrefix).length >= 2;
}

function normalizeSeriesPrefix(title: string): string | null {
  const prefix = title.split(':', 1)[0] ?? title;
  const normalized = normalizeTitle(prefix);
  return normalized || null;
}

function sharedTitleTokenCount(left: string, right: string): number {
  const leftTokens = new Set(titleTokens(left));
  let shared = 0;
  for (const token of titleTokens(right)) {
    if (leftTokens.has(token)) {
      shared += 1;
    }
  }
  return shared;
}

function titleTokens(value: string): string[] {
  return value.split(' ').filter((token) => token.length >= 3);
}

function normalizeTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFilter(value: unknown): AiSearchFilter {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'movies') {
    return 'movies';
  }
  if (normalized === 'series') {
    return 'series';
  }
  if (normalized === 'anime') {
    return 'anime';
  }
  return 'all';
}

function mapFilterToMetadataFilter(filter: AiSearchFilter): MetadataSearchFilter | null {
  if (filter === 'movies' || filter === 'series' || filter === 'anime') {
    return filter;
  }
  return null;
}

function normalizeLocale(value: unknown): string {
  const normalized = normalizeString(value);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : 'en-US';
}

function summarizeUnresolvedCandidates(candidates: AiSearchCandidate[], resolved: ResolvedSuggestion[]): string[] {
  const resolvedKeys = new Set(resolved.map((item) => candidateKey(item.candidate)));
  return candidates
    .filter((candidate) => !resolvedKeys.has(candidateKey(candidate)))
    .slice(0, 8)
    .map((candidate) => `${candidate.title}${candidate.mediaType ? ` [${candidate.mediaType}]` : ''}`);
}

function candidateKey(candidate: AiSearchCandidate): string {
  return `${normalizeTitle(candidate.title)}::${candidate.mediaType ?? '*'}`;
}

function sampleQuery(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
