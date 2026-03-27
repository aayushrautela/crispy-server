import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { appConfig } from '../../config/app-config.js';
import { env } from '../../config/env.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AiProviderResolver } from './ai-provider-resolver.js';
import { OpenAiCompatibleClient } from './openai-compatible.client.js';
import type { AiCandidateMediaType, AiSearchFilter, AiSearchItem, AiSearchResponse } from './ai.types.js';

type QueryAnalysis = {
  isRecommendation: boolean;
  anchorHint: string | null;
};

type ResolvedSuggestion = {
  sourceTitle: string;
  item: AiSearchItem;
};

const FINAL_RESULT_LIMIT = 12;
const RAW_SUGGESTION_LIMIT = 16;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

export class AiSearchService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly aiProviderResolver = new AiProviderResolver(),
    private readonly aiClient = new OpenAiCompatibleClient(),
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
    const request = await this.aiProviderResolver.resolveForUser(userId, 'search');

    const generated = await this.aiClient.generateJson({
      provider: request.provider,
      apiKey: request.apiKey,
      model: request.model,
      systemPrompt: 'Return compact, valid JSON only. Never include markdown fences. Suggest real movie or TV titles only.',
      userPrompt: buildSearchPrompt(query, filter, locale, analysis),
    });

    const suggestedTitles = dedupeTitles(Array.isArray(generated.items) ? generated.items : []);
    const resolvedSuggestions = await resolveSuggestions(suggestedTitles, filter, locale);
    const items = finalizeResolvedItems(resolvedSuggestions, analysis);
    return { items };
  }
}

function buildSearchPrompt(query: string, filter: AiSearchFilter, locale: string, analysis: QueryAnalysis): string {
  const lines = [
    'You help a streaming app answer what-to-watch questions like a smart friend.',
    `User query: ${query}`,
    `Catalog scope: ${catalogScopeInstruction(filter)}`,
    `Preferred locale: ${locale}`,
    'Suggest real released titles only.',
    'Prefer canonical English title names that TMDB is likely to recognize.',
  ];

  if (analysis.isRecommendation) {
    lines.push('This is a recommendation query, not a direct title lookup.');
    if (analysis.anchorHint) {
      lines.push(`Anchor phrase: ${analysis.anchorHint}`);
    }
    lines.push(`Return up to ${RAW_SUGGESTION_LIMIT} genuinely diverse titles.`);
    lines.push('Do not include the exact title or closest obvious match the user already asked about.');
    lines.push('Include at most one title from the same franchise, collection, series, or shared universe.');
    lines.push('Avoid sequels, prequels, spinoffs, reboots, or multiple entries from the same property unless the user explicitly asks for that property.');
    lines.push('If you include one franchise-adjacent pick, use the rest of the list for broader nearby recommendations with similar tone, audience, world, genre, or premise.');
  } else {
    lines.push('If the query sounds like a direct title lookup, include that title first.');
    lines.push(`Return up to ${RAW_SUGGESTION_LIMIT} distinct titles.`);
  }

  lines.push('Do not include years, media types, numbering, commentary, or markdown.');
  lines.push('Return ONLY a JSON object with this shape:');
  lines.push('{"items":["Title One","Title Two"]}');
  return lines.join('\n\n');
}

function catalogScopeInstruction(filter: AiSearchFilter): string {
  if (filter === 'movies') {
    return 'Only suggest movies.';
  }
  if (filter === 'series') {
    return 'Only suggest TV shows.';
  }
  return 'You may suggest movies or TV shows.';
}

function dedupeTitles(items: unknown[]): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = normalizeSuggestedTitle(item);
    if (!title) {
      continue;
    }

    const key = normalizeTitle(title);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

function normalizeSuggestedTitle(value: unknown): string | null {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && typeof (value as Record<string, unknown>).title === 'string'
      ? String((value as Record<string, unknown>).title)
      : '';

  const normalized = raw
    .trim()
    .replace(/^\d+[.)\-:\s]+/, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();

  return normalized || null;
}

async function resolveSuggestions(titles: string[], filter: AiSearchFilter, locale: string): Promise<ResolvedSuggestion[]> {
  const resolved = await Promise.all(
    titles.map(async (title) => {
      const item = await resolveSuggestion(title, filter, locale);
      return item ? { sourceTitle: title, item } : null;
    }),
  );
  return resolved.filter((item): item is ResolvedSuggestion => item !== null);
}

async function resolveSuggestion(title: string, filter: AiSearchFilter, locale: string): Promise<AiSearchItem | null> {
  const params: Record<string, string> = {
    query: title,
    page: '1',
    include_adult: 'false',
    language: locale,
  };

  if (filter === 'movies') {
    return selectBestTmdbMatch(await searchTmdb('movie', params), title);
  }
  if (filter === 'series') {
    return selectBestTmdbMatch(await searchTmdb('tv', params), title);
  }

  const [movies, series] = await Promise.all([
    searchTmdb('movie', params),
    searchTmdb('tv', params),
  ]);
  return selectBestTmdbMatch([...movies, ...series], title);
}

async function searchTmdb(mediaType: AiCandidateMediaType, params: Record<string, string>): Promise<AiSearchItem[]> {
  const url = new URL(`${appConfig.metadata.tmdb.baseUrl.replace(/\/$/, '')}/search/${mediaType}`);
  url.searchParams.set('api_key', env.tmdbApiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new HttpError(502, `TMDB search failed with HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results
    .map((item) => toTmdbItem(item, mediaType))
    .filter((item): item is AiSearchItem => item !== null);
}

function toTmdbItem(item: unknown, mediaType: AiCandidateMediaType): AiSearchItem | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const row = item as Record<string, unknown>;
  const id = typeof row.id === 'number' ? row.id : 0;
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const rawTitle = mediaType === 'movie' ? row.title : row.name;
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (!title) {
    return null;
  }

  const rawDate = mediaType === 'movie' ? row.release_date : row.first_air_date;
  const year = typeof rawDate === 'string' && rawDate.length >= 4 ? rawDate.slice(0, 4) : null;
  const rating = typeof row.vote_average === 'number' && Number.isFinite(row.vote_average)
    ? row.vote_average.toFixed(1)
    : null;

  return {
    id,
    mediaType,
    title,
    year,
    posterUrl: tmdbImageUrl(typeof row.poster_path === 'string' ? row.poster_path : null, 'w500'),
    backdropUrl: tmdbImageUrl(typeof row.backdrop_path === 'string' ? row.backdrop_path : null, 'w780'),
    rating,
    overview: typeof row.overview === 'string' ? row.overview.trim() || null : null,
  };
}

function selectBestTmdbMatch(items: AiSearchItem[], title: string): AiSearchItem | null {
  const normalizedTarget = normalizeTitle(title);
  const sorted = [...items].sort((left, right) => scoreTmdbMatch(right, normalizedTarget) - scoreTmdbMatch(left, normalizedTarget));
  return sorted[0] ?? null;
}

function scoreTmdbMatch(item: AiSearchItem, normalizedTarget: string): number {
  let score = 0;
  const normalizedTitle = normalizeTitle(item.title);
  if (normalizedTitle === normalizedTarget) {
    score += 120;
  } else if (normalizedTitle.startsWith(normalizedTarget) || normalizedTarget.startsWith(normalizedTitle)) {
    score += 80;
  } else if (normalizedTitle.includes(normalizedTarget) || normalizedTarget.includes(normalizedTitle)) {
    score += 40;
  }

  score += Math.min(sharedTitleTokenCount(normalizedTitle, normalizedTarget) * 12, 36);
  if (item.posterUrl) {
    score += 10;
  }
  return score;
}

function finalizeResolvedItems(resolved: ResolvedSuggestion[], analysis: QueryAnalysis): AiSearchItem[] {
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
    if (kept.some((existing) => isSameTitleFamily(existing.item.title, suggestion.item.title))) {
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
    const key = `${suggestion.item.mediaType}:${suggestion.item.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(suggestion);
  }
  return result;
}

function analyzeQuery(query: string): QueryAnalysis {
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

  return titleMatchesAnchor(suggestion.sourceTitle, normalizedAnchor)
    || titleMatchesAnchor(suggestion.item.title, normalizedAnchor);
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

function tmdbImageUrl(path: string | null, size: string): string | null {
  if (!path) {
    return null;
  }
  const base = appConfig.metadata.tmdb.imageBaseUrl.replace(/\/$/, '');
  return `${base}/${size}${path.startsWith('/') ? path : `/${path}`}`;
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
  return 'all';
}

function normalizeLocale(value: unknown): string {
  const normalized = normalizeString(value);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : 'en-US';
}
