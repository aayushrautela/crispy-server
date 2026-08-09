import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { buildImageUrl, buildResponsiveImageSet, emptyResponsiveImageSet } from './metadata-builder.shared.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { TmdbClient } from './providers/tmdb.client.js';
import { TmdbResponseCacheService } from './providers/tmdb-response-cache.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { TmdbTitleType } from './providers/tmdb.types.js';
import type { MetadataPersonDetail, MetadataPersonKnownForItem } from './metadata-detail.types.js';
import type { MetadataTitleMediaType } from './metadata-card.types.js';
import { normalizeMetadataLanguage, toTmdbLanguageQuery } from './metadata-language.js';

export class PersonDetailService {
  constructor(
    private readonly tmdbClient = new TmdbClient(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly responseCache = new TmdbResponseCacheService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async getPersonDetail(personId: string, language?: string | null): Promise<MetadataPersonDetail> {
    return withDbClient(async (client) => {
      const personRef = await this.contentIdentityService.resolvePersonProviderRef(client, personId, 'tmdb');
      const tmdbPersonId = Number(personRef.externalId);
      if (!Number.isInteger(tmdbPersonId) || tmdbPersonId <= 0) {
        throw new HttpError(404, 'Person metadata not found.');
      }
      const normalizedLanguage = normalizeMetadataLanguage(language);
      const response = await this.responseCache.getOrFetch(
        client,
        {
          resourceType: 'person',
          resourceId: String(tmdbPersonId),
          variant: 'detail',
          language: normalizedLanguage,
          requestPath: `/person/${tmdbPersonId}`,
          requestQuery: { append_to_response: 'combined_credits,external_ids', language: toTmdbLanguageQuery(normalizedLanguage) },
        },
        'person',
        () => this.tmdbClient.request(`/person/${tmdbPersonId}`, {
          append_to_response: 'combined_credits,external_ids',
          language: toTmdbLanguageQuery(normalizedLanguage),
        }),
      );

      if (response.isNegative || response.statusCode === 404) {
        throw new HttpError(404, 'Person metadata not found.');
      }

      const payload = response.responseJson;
      const name = asString(payload.name);
      if (!name) {
        throw new HttpError(404, 'Person metadata not found.');
      }

      return {
        personId,
        name,
        knownForDepartment: asString(payload.known_for_department),
        biography: asString(payload.biography),
        birthday: asString(payload.birthday),
        placeOfBirth: asString(payload.place_of_birth),
        profileUrl: buildImageUrl(asString(payload.profile_path), 'h632'),
        knownFor: await buildKnownForItems(client, payload, this.contentIdentityService, this.tmdbCacheService, normalizedLanguage),
      };
    });
  }
}

async function buildKnownForItems(
  client: DbClient,
  payload: Record<string, unknown>,
  contentIdentityService: ContentIdentityService,
  tmdbCacheService: TmdbCacheService,
  language: string | null,
): Promise<MetadataPersonKnownForItem[]> {
  const cast = asArray(asRecord(payload.combined_credits)?.cast);
  const seen = new Set<string>();
  const items: Array<MetadataPersonKnownForItem & { popularity: number; tmdbId: number; tmdbMediaType: TmdbTitleType }> = [];

  for (const value of cast) {
    const record = asRecord(value);
    if (!record) {
      continue;
    }

    const mediaType = record.media_type === 'movie' ? 'movie' : record.media_type === 'tv' ? 'show' : null;
    const tmdbId = asPositiveNumber(record.id);
    if (!mediaType || !tmdbId) {
      continue;
    }

    const key = `${mediaType}:${tmdbId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const title = mediaType === 'movie'
      ? asString(record.title) ?? asString(record.name)
      : asString(record.name) ?? asString(record.title);
    if (!title) {
      continue;
    }

    const releaseDate = mediaType === 'movie' ? asString(record.release_date) : asString(record.first_air_date);
    items.push({
      mediaType,
      itemId: await ensureKnownForItemId(client, contentIdentityService, mediaType, tmdbId),
      title,
      poster: buildResponsiveImageSet(asString(record.poster_path), {
        small: 'w342',
        medium: 'w500',
        large: 'w780',
      }),
      backdrop: emptyResponsiveImageSet(),
      logo: emptyResponsiveImageSet(),
      rating: asFiniteNumber(record.vote_average),
      releaseYear: releaseDate ? parseYear(releaseDate) : null,
      popularity: asFiniteNumber(record.popularity) ?? 0,
      tmdbId,
      tmdbMediaType: mediaType === 'movie' ? 'movie' : 'tv',
      overview: null,
      genres: [],
    });
  }

  const top = items
    .sort((left, right) => right.popularity - left.popularity)
    .slice(0, 20);

  if (top.length === 0) {
    return [];
  }

  const titleMap = await tmdbCacheService.getTitles(
    client,
    top.map((item) => ({ mediaType: item.tmdbMediaType, tmdbId: item.tmdbId })),
    language,
  );

  return top.map((item) => {
    const titleRecord = titleMap.get(`${item.tmdbMediaType}:${item.tmdbId}`);
    const backdropPath = titleRecord?.backdropPath ?? null;
    const logoPath = extractBestLogoPath(titleRecord?.raw ?? {}, language);
    const { popularity: _popularity, tmdbId: _tmdbId, tmdbMediaType: _tmdbMediaType, ...rest } = item;
    return {
      ...rest,
      backdrop: buildResponsiveImageSet(backdropPath, {
        small: 'w300',
        medium: 'w780',
        large: 'original',
      }),
      logo: buildResponsiveImageSet(logoPath, {
        small: 'w185',
        medium: 'w300',
        large: 'original',
      }),
      overview: titleRecord?.overview ?? null,
      genres: extractGenres(titleRecord?.raw ?? {}),
    };
  });
}

async function ensureKnownForItemId(client: DbClient, contentIdentityService: ContentIdentityService, mediaType: MetadataTitleMediaType, tmdbId: number): Promise<string> {
  const contentId = await contentIdentityService.ensureContentId(client, {
    mediaKey: `${mediaType}:tmdb:${tmdbId}`,
    mediaType,
    provider: 'tmdb',
    providerId: String(tmdbId),
    tmdbId,
    showTmdbId: mediaType === 'show' ? tmdbId : null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
  });
  return contentId.replaceAll('-', '').toLowerCase();
}

function parseYear(value: string): number | null {
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) && year >= 1800 && year <= 3000 ? year : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function extractBestLogoPath(raw: Record<string, unknown>, preferredLanguage?: string | null): string | null {
  const images = asRecord(raw.images);
  const logos = asArray(images?.logos)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const preferred = preferredLanguage
    ? (logos.find((logo) => asString(logo.iso_639_1) === preferredLanguage)
      ?? logos.find((logo) => asString(logo.iso_639_1) === 'en')
      ?? logos[0])
    : (logos.find((logo) => asString(logo.iso_639_1) === 'en')
      ?? logos[0]);

  return preferred ? asString(preferred.file_path) : null;
}

function extractGenres(raw: Record<string, unknown>): string[] {
  const genres = asArray(raw.genres)
    .map((genre) => asRecord(genre))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  return genres
    .map((genre) => asString(genre.name))
    .filter((value): value is string => value !== null);
}
