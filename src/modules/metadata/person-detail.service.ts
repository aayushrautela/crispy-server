import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { buildImageUrl } from './metadata-builder.shared.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { buildDetailBaseItemDto } from './metadata-detail.builders.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { MetadataPersonDetail } from './metadata-detail.types.js';
import type { BaseItemDto } from './media-item.types.js';

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

/** Known-for titles are hydrated by the credits join and shaped identically to Similar rails (BaseItemDto). */
async function buildKnownForItems(
  client: DbClient,
  tmdbCacheService: TmdbCacheService,
  contentIdentityService: ContentIdentityService,
  personTmdbId: number,
  language: string | null | undefined,
): Promise<BaseItemDto[]> {
  const credits = await tmdbCacheService.getPersonCredits(client, personTmdbId, language);
  const titles = credits
    .map((credit) => credit.title)
    .filter((title) => (title.mediaType === 'movie' || title.mediaType === 'tv') && Boolean(title.name));
  if (titles.length === 0) {
    return [];
  }

  const entries = titles.map((title) => ({
    title,
    identity: inferMediaIdentity({
      mediaType: title.mediaType === 'movie' ? 'movie' : 'show',
      tmdbId: title.tmdbId,
    }),
  }));
  const contentIds = await contentIdentityService.ensureContentIds(client, entries.map((entry) => entry.identity));

  const items: BaseItemDto[] = [];
  for (const entry of entries) {
    const contentId = contentIds.get(entry.identity.mediaKey);
    if (!contentId) {
      continue;
    }
    items.push(buildDetailBaseItemDto({
      identity: entry.identity,
      itemId: encodePublicItemId(contentId),
      title: entry.title,
      language: language ?? null,
    }));
  }
  return items;
}
