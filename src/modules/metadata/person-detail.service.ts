import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { buildImageUrl } from './metadata-builder.shared.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { TmdbClient } from './providers/tmdb.client.js';
import type { MetadataPersonDetail, MetadataPersonKnownForItem } from './metadata-detail.types.js';

export class PersonDetailService {
  constructor(
    private readonly tmdbClient = new TmdbClient(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async getPersonDetail(personId: string, language?: string | null): Promise<MetadataPersonDetail> {
    return withDbClient(async (client) => {
      const tmdbPersonId = await this.contentIdentityService.resolvePersonTmdbId(client, personId);
      const payload = await this.tmdbClient.fetchPerson(tmdbPersonId, language ?? null);
      const name = asString(payload.name);
      if (!name) {
        throw new HttpError(404, 'Person metadata not found.');
      }

      const externalIds = asRecord(payload.external_ids);
      return {
        id: await this.contentIdentityService.ensurePersonContentId(client, tmdbPersonId),
        provider: 'tmdb',
        providerId: String(tmdbPersonId),
        tmdbPersonId,
        name,
        knownForDepartment: asString(payload.known_for_department),
        biography: asString(payload.biography),
        birthday: asString(payload.birthday),
        placeOfBirth: asString(payload.place_of_birth),
        profileUrl: buildImageUrl(asString(payload.profile_path), 'h632'),
        imdbId: normalizeImdbId(asString(externalIds?.imdb_id)),
        instagramId: asString(externalIds?.instagram_id),
        twitterId: asString(externalIds?.twitter_id),
        knownFor: await buildKnownForItems(client, payload),
      };
    });
  }
}

async function buildKnownForItems(
  _client: DbClient,
  payload: Record<string, unknown>,
): Promise<MetadataPersonKnownForItem[]> {
  const cast = asArray(asRecord(payload.combined_credits)?.cast);
  const seen = new Set<string>();
  const items: Array<MetadataPersonKnownForItem & { popularity: number }> = [];

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
      mediaKey: `${mediaType}:tmdb:${tmdbId}`,
      provider: 'tmdb',
      providerId: String(tmdbId),
      tmdbId,
      title,
      posterUrl: buildImageUrl(asString(record.poster_path), 'w500'),
      rating: asFiniteNumber(record.vote_average),
      releaseYear: releaseDate ? parseYear(releaseDate) : null,
      popularity: asFiniteNumber(record.popularity) ?? 0,
    });
  }

  return items
    .sort((left, right) => right.popularity - left.popularity)
    .slice(0, 20)
    .map(({ popularity: _popularity, ...item }) => item);
}

function parseYear(value: string): number | null {
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) && year >= 1800 && year <= 3000 ? year : null;
}

function normalizeImdbId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('tt')) {
    return trimmed;
  }
  return /^\d+$/.test(trimmed) ? `tt${trimmed}` : null;
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
