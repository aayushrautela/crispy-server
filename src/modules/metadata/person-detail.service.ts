import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { buildImageUrl, buildResponsiveImageSet, emptyResponsiveImageSet, extractGenres } from './metadata-builder.shared.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { TmdbTitleRecord, TmdbTitleType } from './providers/tmdb.types.js';
import type { MetadataPersonDetail, MetadataPersonKnownForItem } from './metadata-detail.types.js';
import type { MetadataTitleMediaType } from './metadata-card.types.js';

export class PersonDetailService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async getPersonDetail(personId: string, language?: string | null): Promise<MetadataPersonDetail> {
    return withDbClient(async (client) => {
      const personRef = await this.contentIdentityService.resolvePersonProviderRef(client, personId, 'tmdb');
      const tmdbPersonId = Number(personRef.externalId);
      if (!Number.isInteger(tmdbPersonId) || tmdbPersonId <= 0) {
        throw new HttpError(404, 'Person metadata not found.');
      }

      const person = await this.loadPerson(client, tmdbPersonId, language);
      if (!person) {
        throw new HttpError(404, 'Person metadata not found.');
      }

      return {
        personId,
        name: person.name,
        knownForDepartment: person.knownForDepartment,
        biography: person.biography,
        birthday: person.birthday,
        placeOfBirth: person.placeOfBirth,
        profileUrl: buildImageUrl(person.profilePath ?? null, 'h632'),
        knownFor: await buildKnownForItems(client, this.tmdbCacheService, this.contentIdentityService, tmdbPersonId, language),
      };
    });
  }

  private async loadPerson(client: DbClient, tmdbPersonId: number, language?: string | null) {
    const cached = await this.tmdbCacheService.getPerson(client, tmdbPersonId);
    if (cached && Date.parse(cached.expiresAt) > Date.now()) {
      return cached;
    }

    try {
      return await this.tmdbCacheService.ingestPerson(client, tmdbPersonId, language ?? undefined);
    } catch (error) {
      if (cached) {
        return cached;
      }
      throw error;
    }
  }
}

async function buildKnownForItems(
  client: DbClient,
  tmdbCacheService: TmdbCacheService,
  contentIdentityService: ContentIdentityService,
  personTmdbId: number,
  language: string | null | undefined,
): Promise<MetadataPersonKnownForItem[]> {
  const credits = await tmdbCacheService.getPersonCredits(client, personTmdbId, language);
  if (credits.length === 0) {
    return [];
  }

  const items: Array<MetadataPersonKnownForItem & { popularity: number; tmdbId: number; tmdbMediaType: TmdbTitleType }> = [];
  for (const credit of credits) {
    const title = credit.title;
    const mediaType: MetadataTitleMediaType | null = title.mediaType === 'movie' ? 'movie' : 'show';
    if (!mediaType || !title.name) {
      continue;
    }

    items.push({
      mediaType,
      itemId: await ensureKnownForItemId(client, contentIdentityService, mediaType, title.tmdbId),
      title: title.name,
      poster: buildResponsiveImageSet(title.posterPath, {
        small: 'w342',
        medium: 'w500',
        large: 'w780',
      }),
      backdrop: emptyResponsiveImageSet(),
      logo: emptyResponsiveImageSet(),
      rating: ratingOf(title),
      releaseYear: parseYear((title.releaseDate ?? title.firstAirDate) ?? ''),
      popularity: 0,
      tmdbId: title.tmdbId,
      tmdbMediaType: title.mediaType === 'movie' ? 'movie' : 'tv',
      overview: null,
      genres: [],
    });
  }

  if (items.length === 0) {
    return [];
  }

  const titleMap = await tmdbCacheService.getTitles(
    client,
    items.map((item) => ({ mediaType: item.tmdbMediaType, tmdbId: item.tmdbId })),
    language,
  );

  return items.map((item) => {
    const titleRecord = titleMap.get(`${item.tmdbMediaType}:${item.tmdbId}`);
    const backdropPath = titleRecord?.backdropPath ?? null;
    const logoPath = titleRecord?.logoPath ?? null;
    const { popularity: _popularity, tmdbId: _tmdbId, tmdbMediaType: _tmdbMediaType, ...rest } = item;
    return {
      ...rest,
      backdrop: buildResponsiveImageSet(backdropPath, {
        small: 'w780',
        medium: 'w1280',
        large: 'original',
      }),
      logo: buildResponsiveImageSet(logoPath, {
        small: 'w185',
        medium: 'w500',
        large: 'original',
      }),
      overview: titleRecord?.overview ?? null,
      genres: extractGenres(titleRecord ?? null),
    };
  });
}

function ratingOf(title: TmdbTitleRecord): number | null {
  const value = title.raw.vote_average;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
