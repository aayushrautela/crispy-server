import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { inferMediaIdentity, type MediaIdentity } from '../watch/media-key.js';
import {
  ContentIdentityRepository,
  type ContentEntityType,
  type ContentProviderRefInput,
  type ContentProviderRefRecord,
} from './content-identity.repo.js';

export type CanonicalContentReference =
  | {
      contentId: string;
      entityType: 'movie' | 'show' | 'episode';
      mediaIdentity: MediaIdentity;
    }
  | {
      contentId: string;
      entityType: 'season';
      showTmdbId: number;
      seasonNumber: number;
    }
  | {
      contentId: string;
      entityType: 'person';
      tmdbPersonId: number;
    };

type TitleIdentityInput = {
  mediaType: 'movie' | 'show';
  tmdbId: number;
};

type EpisodeIdentityInput = {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ContentIdentityService {
  constructor(private readonly repository = new ContentIdentityRepository()) {}

  async ensureContentId(client: DbClient, identity: MediaIdentity): Promise<string> {
    if (identity.mediaType === 'episode') {
      if (!identity.showTmdbId || identity.seasonNumber === null || identity.episodeNumber === null) {
        throw new HttpError(400, 'Unable to resolve canonical content id.');
      }
      return this.ensureEpisodeContentId(client, {
        showTmdbId: identity.showTmdbId,
        seasonNumber: identity.seasonNumber,
        episodeNumber: identity.episodeNumber,
      });
    }

    if (!identity.tmdbId) {
      throw new HttpError(400, 'Unable to resolve canonical content id.');
    }

    return this.ensureTitleContentId(client, {
      mediaType: identity.mediaType,
      tmdbId: identity.tmdbId,
    });
  }

  async ensureContentIds(client: DbClient, identities: MediaIdentity[]): Promise<Map<string, string>> {
    const titleInputs: TitleIdentityInput[] = [];
    const episodeInputs: EpisodeIdentityInput[] = [];

    for (const identity of identities) {
      if (identity.mediaType === 'episode') {
        if (!identity.showTmdbId || identity.seasonNumber === null || identity.episodeNumber === null) {
          continue;
        }
        episodeInputs.push({
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
        });
        continue;
      }

      if (!identity.tmdbId) {
        continue;
      }

      titleInputs.push({
        mediaType: identity.mediaType,
        tmdbId: identity.tmdbId,
      });
    }

    const [titleIds, episodeIds] = await Promise.all([
      this.ensureTitleContentIds(client, titleInputs),
      this.ensureEpisodeContentIds(client, episodeInputs),
    ]);

    const resolved = new Map<string, string>();
    for (const identity of identities) {
      if (identity.mediaType === 'episode') {
        if (!identity.showTmdbId || identity.seasonNumber === null || identity.episodeNumber === null) {
          continue;
        }
        const contentId = episodeIds.get(episodeRefMapKey(identity.showTmdbId, identity.seasonNumber, identity.episodeNumber));
        if (contentId) {
          resolved.set(identity.mediaKey, contentId);
        }
        continue;
      }

      if (!identity.tmdbId) {
        continue;
      }

      const contentId = titleIds.get(titleRefMapKey(identity.mediaType, identity.tmdbId));
      if (contentId) {
        resolved.set(identity.mediaKey, contentId);
      }
    }

    return resolved;
  }

  async ensureTitleContentId(client: DbClient, input: TitleIdentityInput): Promise<string> {
    const [record] = await this.repository.ensureProviderRefs(client, [toTitleRef(input)]);
    return assertContentId(record);
  }

  async ensureTitleContentIds(client: DbClient, inputs: TitleIdentityInput[]): Promise<Map<string, string>> {
    const records = await this.repository.ensureProviderRefs(client, inputs.map((input) => toTitleRef(input)));
    return new Map(records.map((record) => [titleKey(record.entityType as 'movie' | 'show', record.externalId), record.contentId]));
  }

  async ensureEpisodeContentId(client: DbClient, input: EpisodeIdentityInput): Promise<string> {
    const [record] = await this.repository.ensureProviderRefs(client, [toEpisodeRef(input)]);
    return assertContentId(record);
  }

  async ensureEpisodeContentIds(client: DbClient, inputs: EpisodeIdentityInput[]): Promise<Map<string, string>> {
    const records = await this.repository.ensureProviderRefs(client, inputs.map((input) => toEpisodeRef(input)));
    return new Map(records.map((record) => [record.externalId, record.contentId]));
  }

  async ensureSeasonContentId(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<string> {
    const [record] = await this.repository.ensureProviderRefs(client, [toSeasonRef(showTmdbId, seasonNumber)]);
    return assertContentId(record);
  }

  async ensureSeasonContentIds(client: DbClient, showTmdbId: number, seasonNumbers: number[]): Promise<Map<number, string>> {
    const records = await this.repository.ensureProviderRefs(
      client,
      seasonNumbers.map((seasonNumber) => toSeasonRef(showTmdbId, seasonNumber)),
    );
    return new Map(
      records.map((record) => {
        const { seasonNumber } = parseSeasonExternalId(record.externalId);
        return [seasonNumber, record.contentId] as const;
      }),
    );
  }

  async ensurePersonContentId(client: DbClient, tmdbPersonId: number): Promise<string> {
    const [record] = await this.repository.ensureProviderRefs(client, [toPersonRef(tmdbPersonId)]);
    return assertContentId(record);
  }

  async resolveMediaIdentity(client: DbClient, contentId: string): Promise<MediaIdentity> {
    const reference = await this.resolveContentReference(client, contentId);
    if (reference.entityType === 'season' || reference.entityType === 'person') {
      throw new HttpError(400, 'Invalid metadata id.');
    }
    return reference.mediaIdentity;
  }

  async resolveSeasonReference(client: DbClient, contentId: string): Promise<{ showTmdbId: number; seasonNumber: number }> {
    const reference = await this.resolveContentReference(client, contentId);
    if (reference.entityType !== 'season') {
      throw new HttpError(400, 'Invalid season id.');
    }
    return {
      showTmdbId: reference.showTmdbId,
      seasonNumber: reference.seasonNumber,
    };
  }

  async resolvePersonTmdbId(client: DbClient, contentId: string): Promise<number> {
    const trimmed = contentId.trim();
    const direct = Number(trimmed);
    if (Number.isInteger(direct) && direct > 0) {
      return direct;
    }

    const reference = await this.resolveContentReference(client, trimmed);
    if (reference.entityType !== 'person') {
      throw new HttpError(400, 'Invalid person id.');
    }
    return reference.tmdbPersonId;
  }

  async resolveContentReference(client: DbClient, contentId: string): Promise<CanonicalContentReference> {
    const normalized = normalizeContentId(contentId);
    const refs = await this.repository.listProviderRefsByContentId(client, normalized);
    const tmdbRef = refs.find((record) => record.provider === 'tmdb');
    if (!tmdbRef) {
      throw new HttpError(404, 'Metadata not found.');
    }

    if (tmdbRef.entityType === 'movie' || tmdbRef.entityType === 'show') {
      const tmdbId = parsePositiveInteger(tmdbRef.externalId, 'Invalid metadata id.');
      return {
        contentId: normalized,
        entityType: tmdbRef.entityType,
        mediaIdentity: inferMediaIdentity({ mediaType: tmdbRef.entityType, tmdbId }),
      };
    }

    if (tmdbRef.entityType === 'episode') {
      const parsed = parseEpisodeExternalId(tmdbRef.externalId);
      return {
        contentId: normalized,
        entityType: 'episode',
        mediaIdentity: inferMediaIdentity({
          mediaType: 'episode',
          showTmdbId: parsed.showTmdbId,
          seasonNumber: parsed.seasonNumber,
          episodeNumber: parsed.episodeNumber,
        }),
      };
    }

    if (tmdbRef.entityType === 'season') {
      return {
        contentId: normalized,
        entityType: 'season',
        ...parseSeasonExternalId(tmdbRef.externalId),
      };
    }

    return {
      contentId: normalized,
      entityType: 'person',
      tmdbPersonId: parsePositiveInteger(tmdbRef.externalId, 'Invalid person id.'),
    };
  }
}

export function titleRefMapKey(mediaType: 'movie' | 'show', tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

export function episodeRefMapKey(showTmdbId: number, seasonNumber: number, episodeNumber: number): string {
  return `${showTmdbId}:${seasonNumber}:${episodeNumber}`;
}

function normalizeContentId(contentId: string): string {
  const normalized = contentId.trim();
  if (!UUID_RE.test(normalized)) {
    throw new HttpError(400, 'Invalid metadata id.');
  }
  return normalized.toLowerCase();
}

function toTitleRef(input: TitleIdentityInput): ContentProviderRefInput {
  return {
    provider: 'tmdb',
    entityType: input.mediaType,
    externalId: String(input.tmdbId),
    metadata: { tmdbId: input.tmdbId },
  };
}

function toEpisodeRef(input: EpisodeIdentityInput): ContentProviderRefInput {
  return {
    provider: 'tmdb',
    entityType: 'episode',
    externalId: episodeRefMapKey(input.showTmdbId, input.seasonNumber, input.episodeNumber),
    metadata: {
      showTmdbId: input.showTmdbId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
    },
  };
}

function toSeasonRef(showTmdbId: number, seasonNumber: number): ContentProviderRefInput {
  return {
    provider: 'tmdb',
    entityType: 'season',
    externalId: `${showTmdbId}:${seasonNumber}`,
    metadata: {
      showTmdbId,
      seasonNumber,
    },
  };
}

function toPersonRef(tmdbPersonId: number): ContentProviderRefInput {
  return {
    provider: 'tmdb',
    entityType: 'person',
    externalId: String(tmdbPersonId),
    metadata: { tmdbPersonId },
  };
}

function parsePositiveInteger(value: string, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, message);
  }
  return parsed;
}

function parseEpisodeExternalId(externalId: string): { showTmdbId: number; seasonNumber: number; episodeNumber: number } {
  const parts = externalId.split(':');
  if (parts.length !== 3) {
    throw new HttpError(400, 'Invalid metadata id.');
  }

  return {
    showTmdbId: parsePositiveInteger(parts[0] ?? '', 'Invalid metadata id.'),
    seasonNumber: parseNonNegativeInteger(parts[1] ?? '', 'Invalid metadata id.'),
    episodeNumber: parsePositiveInteger(parts[2] ?? '', 'Invalid metadata id.'),
  };
}

function parseSeasonExternalId(externalId: string): { showTmdbId: number; seasonNumber: number } {
  const parts = externalId.split(':');
  if (parts.length !== 2) {
    throw new HttpError(400, 'Invalid season id.');
  }

  return {
    showTmdbId: parsePositiveInteger(parts[0] ?? '', 'Invalid season id.'),
    seasonNumber: parseNonNegativeInteger(parts[1] ?? '', 'Invalid season id.'),
  };
}

function parseNonNegativeInteger(value: string, message: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, message);
  }
  return parsed;
}

function assertContentId(record: ContentProviderRefRecord | undefined): string {
  if (!record?.contentId) {
    throw new HttpError(500, 'Unable to resolve canonical content id.');
  }
  return record.contentId;
}

function titleKey(mediaType: 'movie' | 'show', externalId: string): string {
  return `${mediaType}:${externalId}`;
}
