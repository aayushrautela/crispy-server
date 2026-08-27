import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { buildImageUrl } from './metadata-builder.shared.js';
import { buildMetadataCardView } from './metadata-card.builders.js';
import { toClientMediaCard } from './client-media-card.mapper.js';
import type { ClientMediaCard } from '../recommendations/client-home.types.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { MetadataPersonDetail } from './metadata-detail.types.js';

export class PersonDetailService {
  constructor(
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
  ) {}

  async getPersonDetail(personId: string, language?: string | null): Promise<MetadataPersonDetail> {
    // Backward compat: hydrates at service boundary via buildKnownForIdentities + MetadataCardService.
    // New callers should use getPersonDetailInternal + route hydration.
    const internal = await this.getPersonDetailInternal(personId, language);
    return withDbClient(async (client) => {
      const knownFor = await this.hydrateKnownFor(client, internal.knownForIdentities, language);
      return {
        personId: internal.personId,
        name: internal.name,
        knownForDepartment: internal.knownForDepartment,
        biography: internal.biography,
        birthday: internal.birthday,
        placeOfBirth: internal.placeOfBirth,
        profileUrl: internal.profileUrl,
        knownFor,
      };
    });
  }

  async getPersonDetailInternal(personId: string, language?: string | null): Promise<{
    personId: string;
    name: string;
    knownForDepartment: string | null;
    biography: string | null;
    birthday: string | null;
    placeOfBirth: string | null;
    profileUrl: string | null;
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
        knownForIdentities,
      };
    });
  }

  private async hydrateKnownFor(client: import('../../lib/db.js').DbClient, identities: import('../identity/media-key.js').MediaIdentity[], language: string | null | undefined): Promise<ClientMediaCard[]> {
    if (!identities.length) return [];
    const { MetadataCardService } = await import('./metadata-card.service.js');
    const metadataCardService = new MetadataCardService();
    const views = await metadataCardService.buildCardViews(client, identities, language ?? null);
    const cards: ClientMediaCard[] = [];
    for (let i = 0; i < identities.length; i++) {
      const view = views[i];
      if (!view || !view.title) continue;
      cards.push(toClientMediaCard(view, { progress: null }));
    }
    return cards;
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

/** @deprecated — use buildKnownForIdentities + route hydration */
async function buildKnownForItems(
  client: DbClient,
  tmdbCacheService: TmdbCacheService,
  contentIdentityService: ContentIdentityService,
  personTmdbId: number,
  language: string | null | undefined,
): Promise<ClientMediaCard[]> {
  const identities = await buildKnownForIdentities(client, tmdbCacheService, contentIdentityService, personTmdbId, language);
  if (!identities.length) return [];
  const { MetadataCardService } = await import('./metadata-card.service.js');
  const metadataCardService = new MetadataCardService();
  const views = await metadataCardService.buildCardViews(client, identities, language ?? null);
  const cards: ClientMediaCard[] = [];
  for (let i = 0; i < identities.length; i++) {
    const view = views[i];
    if (!view || !view.title) continue;
    cards.push(toClientMediaCard(view, { progress: null }));
  }
  return cards;
}
