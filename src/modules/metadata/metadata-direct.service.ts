import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import type { SupportedMediaType } from '../watch/media-key.js';
import { inferMediaIdentity, parentMediaTypeForIdentity, type MediaIdentity } from '../watch/media-key.js';
import {
  buildEpisodeView,
  buildImageUrl,
  buildProviderEpisodeView,
  buildProviderSeasonViewFromRecord,
  buildSeasonViewFromRecord,
} from './metadata-normalizers.js';
import { ContentIdentityService, episodeRefMapKey } from './content-identity.service.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { MetadataViewService } from './metadata-view.service.js';
import { findNextEpisode } from './next-episode.js';
import { MdbListClient } from '../integrations/mdblist.client.js';
import { MdbListService } from '../integrations/mdblist.service.js';
import { TmdbClient } from './providers/tmdb.client.js';
import { TmdbExternalIdResolverService } from './providers/tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type {
  MetadataEpisodeListResponse,
  MetadataNextEpisodeResponse,
  MetadataPersonDetail,
  MetadataPersonKnownForItem,
  MetadataSeasonView,
  MetadataTitleContentResponse,
  MetadataView,
  PlaybackResolveResponse,
} from './metadata.types.js';
import type {
  TmdbEpisodeRecord,
  TmdbTitleRecord,
} from './providers/tmdb.types.js';

type FetchLike = typeof fetch;

type ResolveMetadataInput = {
  id?: string;
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  kitsuId?: string | number | null;
  mediaType?: SupportedMediaType | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

type NextEpisodeInput = {
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  watchedKeys?: string[] | null;
  showId?: string | null;
  nowMs?: number | null;
};

export class MetadataDirectService {
  private readonly mdblistService: MdbListService | null;

  constructor(
    private readonly metadataViewService = new MetadataViewService(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly tmdbClient = new TmdbClient(),
    private readonly fetcher: FetchLike = fetch,
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {
    this.mdblistService = env.mdblistApiKey ? new MdbListService(new MdbListClient(env.mdblistApiKey)) : null;
  }

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
        knownFor: await buildKnownForItems(client, this.contentIdentityService, payload),
      };
    });
  }

  async resolveMetadataView(input: ResolveMetadataInput): Promise<MetadataView> {
    return withDbClient(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      return this.metadataViewService.buildMetadataView(client, identity);
    });
  }

  async resolveMetadataViewWithClient(client: DbClient, input: ResolveMetadataInput): Promise<MetadataView> {
    const identity = await this.resolveIdentity(client, input);
    return this.metadataViewService.buildMetadataView(client, identity);
  }

  async listEpisodes(id: string, requestedSeasonNumber?: number | null): Promise<MetadataEpisodeListResponse> {
    return withDbClient(async (client) => {
      const showIdentity = await this.resolveShowIdentity(client, id);
      const providerContext = await this.providerMetadataService.loadIdentityContext(client, showIdentity);
      if (providerContext?.title) {
        const show = await this.metadataViewService.buildMetadataView(client, showIdentity);
        const seasonNumbers = selectProviderSeasonNumbers(providerContext.episodes, providerContext.title.seasonCount, requestedSeasonNumber ?? null);
        const filteredEpisodes = providerContext.episodes.filter((episode) => seasonNumbers.includes(episode.seasonNumber ?? 1));
        const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
          client,
          filteredEpisodes.map((episode) => ({
            parentMediaType: episode.parentMediaType,
            provider: episode.provider,
            parentProviderId: episode.parentProviderId,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
          })),
        );

        return {
          show,
          requestedSeasonNumber: requestedSeasonNumber ?? null,
          effectiveSeasonNumber: seasonNumbers[0] ?? 1,
          includedSeasonNumbers: seasonNumbers,
          episodes: filteredEpisodes.flatMap((episode) => {
            const contentId = episodeIds.get(episode.providerId);
            return contentId
              ? [buildProviderEpisodeView(providerContext.title!, episode, contentId, show.id)]
              : [];
          }),
        };
      }

      const showTmdbId = assertPresent(showIdentity.tmdbId, 'Show metadata not found.');
      const title = assertPresent(
        await this.tmdbCacheService.ensureTitleCached(client, 'tv', showTmdbId),
        'Show metadata not found.',
      );
      const seasonNumbers = selectEpisodeSeasonNumbers(title, requestedSeasonNumber ?? null);
      const episodes: TmdbEpisodeRecord[] = [];
      for (const seasonNumber of seasonNumbers) {
        await this.tmdbCacheService.ensureSeasonCached(client, showTmdbId, seasonNumber);
        episodes.push(...await this.tmdbCacheService.listEpisodesForSeason(client, showTmdbId, seasonNumber));
      }

      const show = await this.metadataViewService.buildMetadataView(client, showIdentity);
      const dedupedEpisodes = dedupeEpisodes(episodes);
      const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
        client,
        dedupedEpisodes.map((episode) => ({
          parentMediaType: 'show' as const,
          provider: 'tmdb' as const,
          parentProviderId: episode.showTmdbId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
        })),
      );
      const uniqueEpisodes = dedupedEpisodes.map((episode) => buildEpisodeView(
        title,
        episode,
        assertPresent(
          episodeIds.get(episodeRefMapKey(episode.showTmdbId, episode.seasonNumber, episode.episodeNumber)),
          'Episode metadata not found.',
        ),
        show.id,
      ));

      return {
        show,
        requestedSeasonNumber: requestedSeasonNumber ?? null,
        effectiveSeasonNumber: seasonNumbers[0] ?? 1,
        includedSeasonNumbers: seasonNumbers,
        episodes: uniqueEpisodes,
      };
    });
  }

  async getNextEpisode(id: string, input: NextEpisodeInput): Promise<MetadataNextEpisodeResponse> {
    const episodeList = await this.listEpisodes(id, input.currentSeasonNumber);
    const nextEpisode = findNextEpisode({
      currentSeasonNumber: input.currentSeasonNumber,
      currentEpisodeNumber: input.currentEpisodeNumber,
      episodes: episodeList.episodes.map((episode) => ({
        ...episode,
        releaseDate: episode.airDate,
      })),
      watchedKeys: input.watchedKeys ?? null,
      showId: input.showId ?? episodeList.show.id,
      nowMs: input.nowMs ?? null,
    });

    return {
      show: episodeList.show,
      currentSeasonNumber: input.currentSeasonNumber,
      currentEpisodeNumber: input.currentEpisodeNumber,
      item: nextEpisode ? episodeList.episodes.find((episode) => episode.id === nextEpisode.id) ?? null : null,
    };
  }

  async getTitleContent(_userId: string, id: string): Promise<MetadataTitleContentResponse> {
    const item = await withDbClient(async (client) => {
      const identity = await this.resolveTitleIdentity(client, id);
      return this.metadataViewService.buildMetadataView(client, identity);
    });

    if (!this.mdblistService) {
      throw new HttpError(412, 'MDBList is not configured. Set MDBLIST_API_KEY in your environment.');
    }

    const tmdbId = item.externalIds.tmdb;
    if (!tmdbId) {
      throw new HttpError(404, 'Title metadata not available for content lookup.');
    }

    const mediaType = item.mediaType === 'movie' ? 'movie' : 'show';
    const content = await this.mdblistService.getTitle(mediaType, tmdbId);
    if (!content) {
      throw new HttpError(404, 'MDBList content not found for this title.');
    }

    return { item, content };
  }

  async resolvePlayback(input: ResolveMetadataInput): Promise<PlaybackResolveResponse> {
    return withDbClient(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      const item = await this.metadataViewService.buildMetadataView(client, identity);
      let show: MetadataView | null = null;
      let season: MetadataSeasonView | null = null;

      if (identity.mediaType === 'episode' && identity.parentProvider && identity.parentProviderId) {
        const parentMediaType = parentMediaTypeForIdentity(identity);
        const showIdentity = inferMediaIdentity({
          mediaType: parentMediaType,
          provider: identity.parentProvider,
          providerId: identity.parentProviderId,
          tmdbId: identity.showTmdbId,
        });
        show = await this.metadataViewService.buildMetadataView(client, showIdentity);

        if (identity.seasonNumber !== null) {
          const providerSeasonContext = await this.providerMetadataService.loadSeasonContext(client, identity, identity.seasonNumber);
          if (providerSeasonContext?.season) {
            const seasonId = await this.contentIdentityService.ensureSeasonContentId(client, {
              parentMediaType: providerSeasonContext.season.parentMediaType,
              provider: providerSeasonContext.season.provider,
              parentProviderId: providerSeasonContext.season.parentProviderId,
              seasonNumber: identity.seasonNumber,
            });
            season = buildProviderSeasonViewFromRecord(
              providerSeasonContext.season,
              seasonId,
              show.id,
              show.externalIds.tmdb ?? null,
            );
          } else if (identity.showTmdbId) {
            const seasonRecord = await this.tmdbCacheService.ensureSeasonCached(client, identity.showTmdbId, identity.seasonNumber);
            if (seasonRecord) {
              const seasonId = await this.contentIdentityService.ensureSeasonContentId(client, {
                parentMediaType: 'show',
                provider: 'tmdb',
                parentProviderId: identity.showTmdbId,
                seasonNumber: identity.seasonNumber,
              });
              season = buildSeasonViewFromRecord(identity.showTmdbId, seasonRecord, seasonId, show.id);
            }
          }
        }
      }

      return {
        item,
        show,
        season,
      };
    });
  }

  private async resolveShowIdentity(_client: DbClient, id: string): Promise<MediaIdentity & { mediaType: 'show' | 'anime' }> {
    const parsed = await this.contentIdentityService.resolveMediaIdentity(_client, id);
    if (parsed.mediaType === 'show' || parsed.mediaType === 'anime') {
      return {
        ...parsed,
        mediaType: parsed.mediaType,
      };
    }
    throw new HttpError(400, 'Episode listing requires a show id.');
  }

  private async resolveTitleIdentity(client: DbClient, id: string): Promise<MediaIdentity & { mediaType: 'movie' | 'show' | 'anime' }> {
    const parsed = await this.contentIdentityService.resolveMediaIdentity(client, id);
    if (parsed.mediaType !== 'movie' && parsed.mediaType !== 'show' && parsed.mediaType !== 'anime') {
      throw new HttpError(400, 'Title content requires a title id.');
    }

    return {
      ...parsed,
      mediaType: parsed.mediaType,
    };
  }

  private async resolveIdentity(client: DbClient, input: ResolveMetadataInput): Promise<MediaIdentity> {
    if (input.id?.trim()) {
      return this.contentIdentityService.resolveMediaIdentity(client, input.id.trim());
    }

    const mediaType = normalizeResolveMediaType(input.mediaType, input.seasonNumber, input.episodeNumber);

    if (mediaType === 'show' && typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return inferMediaIdentity({
        mediaType: 'show',
        provider: 'tvdb',
        providerId: input.tvdbId,
      });
    }

    if (mediaType === 'anime' && input.kitsuId !== null && input.kitsuId !== undefined && String(input.kitsuId).trim()) {
      return inferMediaIdentity({
        mediaType: 'anime',
        provider: 'kitsu',
        providerId: input.kitsuId,
      });
    }

    if (mediaType === 'episode') {
      if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
        if (input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
          throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
        }

        return inferMediaIdentity({
          mediaType: 'episode',
          provider: 'tvdb',
          parentProvider: 'tvdb',
          parentProviderId: input.tvdbId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
        });
      }

      if (input.kitsuId !== null && input.kitsuId !== undefined && String(input.kitsuId).trim()) {
        if (input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
          throw new HttpError(400, 'Episode resolution requires anime id, season number, and episode number.');
        }

        return inferMediaIdentity({
          mediaType: 'episode',
          provider: 'kitsu',
          parentProvider: 'kitsu',
          parentProviderId: input.kitsuId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
        });
      }
    }

    const resolvedTmdbId = await this.resolveTmdbId(client, input, mediaType);

    if (mediaType === 'episode') {
      if (!resolvedTmdbId || input.seasonNumber === null || input.seasonNumber === undefined || input.episodeNumber === null || input.episodeNumber === undefined) {
        throw new HttpError(400, 'Episode resolution requires show id, season number, and episode number.');
      }

      return inferMediaIdentity({
        mediaType: 'episode',
        showTmdbId: resolvedTmdbId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
      });
    }

    return inferMediaIdentity({
      mediaType,
      tmdbId: assertPresent(resolvedTmdbId, 'Unable to resolve metadata identity.'),
    });
  }

  private async resolveTmdbId(
    client: DbClient,
    input: ResolveMetadataInput,
    mediaType: SupportedMediaType,
  ): Promise<number | null> {
    if (typeof input.tmdbId === 'number' && Number.isInteger(input.tmdbId) && input.tmdbId > 0) {
      return input.tmdbId;
    }

    const imdbId = normalizeImdbId(input.imdbId ?? null);
    if (imdbId) {
      return this.externalIdResolver.resolve(client, {
        source: 'imdb_id',
        externalId: imdbId,
        mediaType: normalizeTmdbResolvableMediaType(mediaType),
      });
    }

    if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return this.externalIdResolver.resolve(client, {
        source: 'tvdb_id',
        externalId: String(input.tvdbId),
        mediaType: normalizeTmdbResolvableMediaType(mediaType),
      });
    }

    return null;
  }
}

function selectEpisodeSeasonNumbers(title: TmdbTitleRecord, requestedSeasonNumber: number | null): number[] {
  const maxSeasonNumber = title.numberOfSeasons && title.numberOfSeasons > 0 ? title.numberOfSeasons : null;
  const effectiveSeasonNumber = requestedSeasonNumber && requestedSeasonNumber > 0
    ? maxSeasonNumber ? Math.min(requestedSeasonNumber, maxSeasonNumber) : requestedSeasonNumber
    : maxSeasonNumber ?? 1;
  const seasons = [Math.max(1, effectiveSeasonNumber)];

  if (requestedSeasonNumber && maxSeasonNumber && effectiveSeasonNumber < maxSeasonNumber) {
    seasons.push(effectiveSeasonNumber + 1);
  }

  return Array.from(new Set(seasons)).sort((left, right) => left - right);
}

function dedupeEpisodes(episodes: TmdbEpisodeRecord[]): TmdbEpisodeRecord[] {
  const deduped = new Map<string, TmdbEpisodeRecord>();
  for (const episode of episodes) {
    deduped.set(`${episode.seasonNumber}:${episode.episodeNumber}`, episode);
  }
  return [...deduped.values()].sort((left, right) => {
    if (left.seasonNumber !== right.seasonNumber) {
      return left.seasonNumber - right.seasonNumber;
    }
    return left.episodeNumber - right.episodeNumber;
  });
}

function normalizeResolveMediaType(
  mediaType: SupportedMediaType | null | undefined,
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
): SupportedMediaType {
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime' || mediaType === 'episode') {
    return mediaType;
  }

  if (seasonNumber !== null && seasonNumber !== undefined && episodeNumber !== null && episodeNumber !== undefined) {
    return 'episode';
  }

  return 'movie';
}

function selectProviderSeasonNumbers(
  episodes: Array<{ seasonNumber: number | null }>,
  seasonCount: number | null,
  requestedSeasonNumber: number | null,
): number[] {
  if (requestedSeasonNumber && requestedSeasonNumber > 0) {
    return [requestedSeasonNumber];
  }

  const values = new Set<number>();
  for (const episode of episodes) {
    values.add(episode.seasonNumber ?? 1);
  }

  if (!values.size && seasonCount && seasonCount > 0) {
    for (let seasonNumber = 1; seasonNumber <= seasonCount; seasonNumber += 1) {
      values.add(seasonNumber);
    }
  }

  if (!values.size) {
    values.add(1);
  }

  return Array.from(values).sort((left, right) => left - right);
}

function normalizeTmdbResolvableMediaType(mediaType: SupportedMediaType): 'movie' | 'show' | 'episode' {
  return mediaType === 'episode' ? 'episode' : mediaType === 'show' ? 'show' : 'movie';
}

async function buildKnownForItems(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  payload: Record<string, unknown>,
): Promise<MetadataPersonKnownForItem[]> {
  const cast = asArray(asRecord(payload.combined_credits)?.cast);
  const seen = new Set<string>();
  const items: Array<MetadataPersonKnownForItem & { popularity: number }> = [];
  const refs: Array<{ mediaType: 'movie' | 'show'; tmdbId: number }> = [];

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

    refs.push({ mediaType, tmdbId });

    const releaseDate = mediaType === 'movie' ? asString(record.release_date) : asString(record.first_air_date);
    items.push({
      id: '',
      mediaType,
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

  const contentIds = await contentIdentityService.ensureTitleContentIds(client, refs.map((ref) => ({
    mediaType: ref.mediaType,
    provider: 'tmdb',
    providerId: ref.tmdbId,
  })));

  return items
    .sort((left, right) => right.popularity - left.popularity)
    .slice(0, 20)
    .flatMap(({ popularity: _popularity, ...item }) => {
      const id = contentIds.get(`${item.mediaType}:${item.tmdbId}`);
      if (!id) {
        return [];
      }

      return [{
        ...item,
        id,
      }];
    });
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
