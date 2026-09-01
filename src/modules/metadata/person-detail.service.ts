import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { buildImageUrl } from './metadata-builder.shared.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';

export class PersonDetailService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async getPersonDetailInternal(personId: string, language?: string | null): Promise<{
    personId: string;
    name: string;
    knownForDepartment: string | null;
    biography: string | null;
    birthday: string | null;
    placeOfBirth: string | null;
    profileUrl: string | null;
    socials: PersonSocials;
    knownForIdentities: import('../identity/media-key.js').MediaIdentity[];
  }> {
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
      const knownForIdentities = await buildKnownForIdentities(client, this.tmdbCacheService, this.contentIdentityService, tmdbPersonId, language);
      return {
        personId,
        name: person.name,
        knownForDepartment: person.knownForDepartment,
        biography: person.biography,
        birthday: person.birthday,
        placeOfBirth: person.placeOfBirth,
        profileUrl: buildImageUrl(person.profilePath ?? null, 'h632'),
        socials: extractSocials(person.raw ?? null),
        knownForIdentities,
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

export type PersonSocials = {
  imdbId: string | null;
  instagram: string | null;
  twitter: string | null;
  facebook: string | null;
  tiktok: string | null;
  youtube: string | null;
};

function extractSocials(raw: Record<string, unknown> | null): PersonSocials {
  const externalIds = (raw?.external_ids as Record<string, unknown> | undefined) ?? {};
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;
  return {
    imdbId: str(externalIds.imdb_id),
    instagram: str(externalIds.instagram_id),
    twitter: str(externalIds.twitter_id),
    facebook: str(externalIds.facebook_id),
    tiktok: str(externalIds.tiktok_id),
    youtube: str(externalIds.youtube_id),
  };
}

/** Phase 4: returns identities only; route hydrates via MetadataCardService. */
async function buildKnownForIdentities(
  client: DbClient,
  tmdbCacheService: TmdbCacheService,
  contentIdentityService: ContentIdentityService,
  personTmdbId: number,
  language: string | null | undefined,
): Promise<MediaIdentity[]> {
  const credits = await tmdbCacheService.getPersonCredits(client, personTmdbId, language);
  const titles = credits
    .map((credit) => credit.title)
    .filter((title) => (title.mediaType === 'movie' || title.mediaType === 'tv') && Boolean(title.name));
  if (titles.length === 0) return [];
  const identities = titles.map((title) =>
    inferMediaIdentity({
      mediaType: title.mediaType === 'movie' ? 'movie' : 'show',
      tmdbId: title.tmdbId,
    }),
  );
  const contentIds = await contentIdentityService.ensureContentIds(client, identities);
  return identities.filter((identity) => contentIds.has(identity.mediaKey));
}
