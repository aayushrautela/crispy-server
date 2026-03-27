import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { appConfig } from '../../config/app-config.js';
import { env } from '../../config/env.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AiInsightsCacheRepository } from './ai-insights-cache.repo.js';
import { AiRequestExecutor } from './ai-request-executor.js';
import { AiProviderResolver, buildAiInsightsGenerationVersion } from './ai-provider-resolver.js';
import type { AiInsightsMediaType, AiInsightsPayload } from './ai.types.js';

type TmdbTitleContext = {
  tmdbId: number;
  mediaType: AiInsightsMediaType;
  title: string;
  year: string | null;
  description: string | null;
  rating: string | null;
  genres: string[];
  reviews: Array<{
    author: string;
    rating: number | null;
    content: string;
  }>;
};

const GENERATION_VERSION = 'v2';

export class AiInsightsService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly cacheRepository = new AiInsightsCacheRepository(),
    private readonly aiProviderResolver = new AiProviderResolver(),
    private readonly aiRequestExecutor = new AiRequestExecutor(),
  ) {}

  async getInsights(userId: string, input: {
    tmdbId: number;
    mediaType: string;
    profileId: string;
    locale?: string | null;
  }): Promise<AiInsightsPayload> {
    const tmdbId = normalizePositiveInt(input.tmdbId);
    const mediaType = normalizeMediaType(input.mediaType);
    const profileId = normalizeString(input.profileId);
    const locale = normalizeLocale(input.locale);

    if (!tmdbId) {
      throw new HttpError(400, 'TMDB id is required.');
    }
    if (!mediaType) {
      throw new HttpError(400, 'Media type must be movie or tv.');
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
    const request = await this.aiProviderResolver.resolveForUser(userId, 'insights');
    const generationVersion = `${GENERATION_VERSION}:${buildAiInsightsGenerationVersion(request)}`;

    const cached = await withTransaction(async (client) => {
      return this.cacheRepository.findByKey(client, {
        tmdbId,
        mediaType,
        locale,
        generationVersion,
      });
    });
    if (cached) {
      return cached.payload;
    }

    const titleContext = await loadTmdbTitleContext(tmdbId, mediaType, locale);
    if (!titleContext) {
      throw new HttpError(404, 'Unable to load title data for AI insights.');
    }

    const execution = await this.aiRequestExecutor.generateJsonForUser({
      userId,
      feature: 'insights',
      userPrompt: buildPrompt(titleContext),
    });
    const generated = execution.payload;
    const actualGenerationVersion = `${GENERATION_VERSION}:${buildAiInsightsGenerationVersion(execution.request)}`;
    const payload = normalizeInsightsPayload(generated);
    if (!payload) {
      throw new HttpError(502, 'AI insights returned invalid data.');
    }

    return withTransaction(async (client) => {
      return this.cacheRepository.upsert(client, {
        tmdbId,
        mediaType,
        locale,
        generationVersion: actualGenerationVersion,
        modelName: `${execution.request.providerId}:${execution.request.model}`,
        payload,
        generatedByProfileId: profileId,
      });
    });
  }
}

async function loadTmdbTitleContext(tmdbId: number, mediaType: AiInsightsMediaType, locale: string): Promise<TmdbTitleContext | null> {
  const url = new URL(`${appConfig.metadata.tmdb.baseUrl.replace(/\/$/, '')}/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbId}`);
  url.searchParams.set('api_key', env.tmdbApiKey);
  url.searchParams.set('language', locale);
  url.searchParams.set('append_to_response', 'reviews');

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const title = typeof payload.title === 'string'
    ? payload.title.trim()
    : typeof payload.name === 'string'
      ? payload.name.trim()
      : '';
  if (!title) {
    return null;
  }

  const rawDate = mediaType === 'movie' ? payload.release_date : payload.first_air_date;
  const year = typeof rawDate === 'string' && rawDate.length >= 4 ? rawDate.slice(0, 4) : null;
  const rating = typeof payload.vote_average === 'number' && Number.isFinite(payload.vote_average)
    ? payload.vote_average.toFixed(1)
    : null;
  const genres = Array.isArray(payload.genres)
    ? payload.genres
      .map((genre) => {
        if (!genre || typeof genre !== 'object' || Array.isArray(genre)) {
          return '';
        }
        const row = genre as Record<string, unknown>;
        return typeof row.name === 'string' ? row.name.trim() : '';
      })
      .filter((name): name is string => Boolean(name))
    : [];

  const reviews = Array.isArray((payload.reviews as Record<string, unknown> | undefined)?.results)
    ? ((payload.reviews as Record<string, unknown>).results as unknown[])
      .map((review) => {
        if (!review || typeof review !== 'object' || Array.isArray(review)) {
          return null;
        }
        const row = review as Record<string, unknown>;
        const authorDetails = row.author_details && typeof row.author_details === 'object' && !Array.isArray(row.author_details)
          ? row.author_details as Record<string, unknown>
          : null;
        const content = typeof row.content === 'string' ? row.content.trim() : '';
        if (!content) {
          return null;
        }
        return {
          author: typeof row.author === 'string' ? row.author.trim() : '',
          rating: typeof authorDetails?.rating === 'number' ? authorDetails.rating : null,
          content,
        };
      })
      .filter((review): review is TmdbTitleContext['reviews'][number] => review !== null)
      .slice(0, 10)
    : [];

  return {
    tmdbId,
    mediaType,
    title,
    year,
    description: typeof payload.overview === 'string' ? payload.overview.trim() || null : null,
    rating,
    genres,
    reviews,
  };
}

function buildPrompt(context: TmdbTitleContext): string {
  const plot = context.description?.trim() || 'N/A';
  const rating = context.rating?.trim() || 'N/A';
  const genres = context.genres.join(', ') || 'N/A';
  const formattedReviews = context.reviews.length === 0
    ? 'No user reviews available.'
    : context.reviews
      .map((review) => {
        const author = review.author || 'Unknown';
        const authorRating = review.rating == null ? 'N/A' : String(review.rating);
        const content = review.content
          .replace(/\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 500);
        return `(Author: ${author}, Rating: ${authorRating}) "${content}"`;
      })
      .join('\n---\n');

  return [
    'Be a film enthusiast, not a critic. Use simple, conversational, and exciting English.',
    'Avoid complex words, academic jargon, or flowery prose. Write like you\'re talking to a friend.',
    'Do NOT use generic headings.',
    'Context:',
    `Title: ${context.title} (${context.year ?? 'N/A'})`,
    `Plot: ${plot}`,
    `Rating: ${rating}`,
    `Genres: ${genres}`,
    'User Reviews:',
    formattedReviews,
    'Task:',
    'Generate a JSON object with:',
    '- insights: an array of 3 objects. Each object must include:',
    '  - category: a short uppercase label (e.g. CONSENSUS, VIBE, STYLE)',
    '  - title: a punchy, short headline',
    '  - content: 2-3 sentences',
    '  - type: one of ["consensus","performance","theme","vibe","style","controversy","character"]',
    '- trivia: one "Did you know?" fact (1-2 sentences)',
    'Return ONLY valid JSON.',
  ].join('\n\n');
}

function normalizeInsightsPayload(payload: Record<string, unknown>): AiInsightsPayload | null {
  const trivia = typeof payload.trivia === 'string' ? payload.trivia.trim() : '';
  const items = Array.isArray(payload.insights) ? payload.insights : [];
  const insights = items
    .map((item) => normalizeInsightCard(item))
    .filter((item): item is AiInsightsPayload['insights'][number] => item !== null)
    .slice(0, 3);

  if (insights.length === 0) {
    return null;
  }

  return {
    insights,
    trivia,
  };
}

function normalizeInsightCard(value: unknown): AiInsightsPayload['insights'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;
  const type = typeof item.type === 'string' ? item.type.trim() : '';
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const category = typeof item.category === 'string' ? item.category.trim() : '';
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  if (!type || !title || !category || !content) {
    return null;
  }
  return { type, title, category, content };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(normalizeString(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMediaType(value: unknown): AiInsightsMediaType | null {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'movie' || normalized === 'tv' ? normalized : null;
}

function normalizeLocale(value: unknown): string {
  const normalized = normalizeString(value);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized) ? normalized : 'en-US';
}
