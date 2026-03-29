import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataQueryService } from '../metadata/metadata-query.service.js';
import type { MetadataCardView, MetadataSearchFilter } from '../metadata/metadata.types.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { buildSearchPrompt, type SearchQueryAnalysis } from './ai-prompts.js';
import { parseSearchCandidates, resolveCandidateFilter, type AiSearchCandidate } from './ai-search-candidates.js';
import type { AiSearchFilter, AiSearchItem, AiSearchResponse } from './ai.types.js';

type ResolvedSuggestion = {
  candidate: AiSearchCandidate;
  item: AiSearchItem;
};

const FINAL_RESULT_LIMIT = 12;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

export class AiSearchService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly aiRequestExecutor = new AiRequestExecutor(),
    private readonly metadataQueryService = new MetadataQueryService(),
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
    const { payload: generated } = await this.aiRequestExecutor.generateJsonForUser({
      userId,
      feature: 'search',
      systemPrompt: 'Return compact, valid JSON only. Never include markdown fences. Suggest real released titles that fit the requested catalog scope.',
      userPrompt: buildSearchPrompt(query, filter, locale, analysis),
    });

    const candidates = parseSearchCandidates(Array.isArray(generated.items) ? generated.items : []);
    const resolvedSuggestions = await resolveSuggestions(this.metadataQueryService, candidates, filter, locale);
    const items = finalizeResolvedItems(resolvedSuggestions, analysis);
    return { items };
  }
}

async function resolveSuggestions(
  metadataQueryService: MetadataQueryService,
  candidates: AiSearchCandidate[],
  filter: AiSearchFilter,
  locale: string,
): Promise<ResolvedSuggestion[]> {
  const resolved = await Promise.all(
    candidates.map(async (candidate) => {
      const item = await resolveSuggestion(metadataQueryService, candidate, filter, locale);
      return item ? { candidate, item } : null;
    }),
  );
  return resolved.filter((item): item is ResolvedSuggestion => item !== null);
}

async function resolveSuggestion(
  metadataQueryService: MetadataQueryService,
  candidate: AiSearchCandidate,
  filter: AiSearchFilter,
  _locale: string,
): Promise<AiSearchItem | null> {
  const searchFilters = resolveCandidateFilter(filter, candidate.mediaType);

  for (const candidateFilter of searchFilters) {
    const response = await metadataQueryService.searchTitles({
      query: candidate.title,
      filter: mapFilterToMetadataFilter(candidateFilter),
      limit: 8,
    });
    const selected = selectBestMetadataMatch(response.items, candidate.title, candidate.mediaType);
    if (selected) {
      return selected;
    }
  }

  return null;
}

function selectBestMetadataMatch(items: MetadataCardView[], title: string, mediaTypeHint: AiSearchCandidate['mediaType']): AiSearchItem | null {
  const normalizedTarget = normalizeTitle(title);
  const sorted = [...items].sort(
    (left, right) => scoreMetadataMatch(right, normalizedTarget, mediaTypeHint) - scoreMetadataMatch(left, normalizedTarget, mediaTypeHint),
  );
  return sorted[0] ?? null;
}

function scoreMetadataMatch(item: MetadataCardView, normalizedTarget: string, mediaTypeHint: AiSearchCandidate['mediaType']): number {
  let score = 0;
  const normalizedTitle = normalizeTitle(item.title ?? '');
  if (normalizedTitle === normalizedTarget) {
    score += 120;
  } else if (normalizedTitle.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedTitle)) {
    score += 80;
  } else if (normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle)) {
    score += 40;
  }

  score += Math.min(sharedTitleTokenCount(normalizedTitle, normalizedTarget) * 12, 36);
  if (matchesMediaTypeHint(item, mediaTypeHint)) {
    score += 30;
  }
  if (item.artwork.posterUrl) {
    score += 10;
  }
  return score;
}

function matchesMediaTypeHint(item: MetadataCardView, mediaTypeHint: AiSearchCandidate['mediaType']): boolean {
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
    const key = suggestion.item.mediaKey;
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

function isSameTitleFamily(leftTitle: string, rightTitle: string): boolean {
  const leftKey = titleFamilyKey(leftTitle);
  const rightKey = titleFamilyKey(rightTitle);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function titleFamilyKey(title: string): string | null {
  const prefix = title.split(/[:\-]/, 1)[0] ?? title;
  const tokens = titleTokens(normalizeTitle(prefix)).filter((token) => !TITLE_STOP_WORDS.has(token));
  if (tokens.length === 0) {
    return null;
  }
  return tokens.slice(0, Math.min(2, tokens.length)).join(' ');
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
