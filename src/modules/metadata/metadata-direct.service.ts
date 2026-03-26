import type { DbClient } from '../../lib/db.js';
import { withDbClient, withTransaction } from '../../lib/db.js';
import { parseStringListEnv } from '../../config/env.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import { AccountSettingsService } from '../users/account-settings.service.js';
import type { SupportedMediaType } from '../watch/media-key.js';
import { inferMediaIdentity, type MediaIdentity } from '../watch/media-key.js';
import {
  buildEpisodeView,
  buildImageUrl,
  buildMetadataId,
  buildSeasonViewFromRecord,
  parseMetadataId,
} from './metadata-normalizers.js';
import { MetadataViewService } from './metadata-view.service.js';
import { findNextEpisode } from './next-episode.js';
import { OmdbCacheRepository } from './omdb-cache.repo.js';
import { TmdbClient } from './tmdb.client.js';
import { TmdbExternalIdResolverService } from './tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from './tmdb-cache.service.js';
import type {
  MetadataEpisodeListResponse,
  MetadataNextEpisodeResponse,
  MetadataPersonDetail,
  MetadataPersonKnownForItem,
  MetadataSeasonView,
  MetadataTitleContentResponse,
  MetadataView,
  OmdbContentView,
  OmdbRatingEntry,
  PlaybackResolveResponse,
  TmdbEpisodeRecord,
  TmdbTitleRecord,
} from './tmdb.types.js';

type FetchLike = typeof fetch;
type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

let omdbServerKeyCursor = 0;
let omdbPoolKeyCursor = 0;

type ResolveMetadataInput = {
  id?: string;
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
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
  constructor(
    private readonly metadataViewService = new MetadataViewService(),
    private readonly externalIdResolver = new TmdbExternalIdResolverService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly tmdbClient = new TmdbClient(),
    private readonly accountSettingsService = new AccountSettingsService(),
    private readonly fetcher: FetchLike = fetch,
    private readonly omdbCacheRepository = new OmdbCacheRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getPersonDetail(personId: string, language?: string | null): Promise<MetadataPersonDetail> {
    const tmdbPersonId = parsePersonTmdbId(personId);
    if (!tmdbPersonId) {
      throw new HttpError(400, 'Invalid person id.');
    }

    const payload = await this.tmdbClient.fetchPerson(tmdbPersonId, language ?? null);
    const name = asString(payload.name);
    if (!name) {
      throw new HttpError(404, 'Person metadata not found.');
    }

    const externalIds = asRecord(payload.external_ids);
    return {
      id: `crisp:person:${tmdbPersonId}`,
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
      knownFor: buildKnownForItems(payload),
    };
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
      const title = assertPresent(
        await this.tmdbCacheService.ensureTitleCached(client, 'tv', showIdentity.tmdbId),
        'Show metadata not found.',
      );
      const seasonNumbers = selectEpisodeSeasonNumbers(title, requestedSeasonNumber ?? null);
      const episodes: TmdbEpisodeRecord[] = [];
      for (const seasonNumber of seasonNumbers) {
        await this.tmdbCacheService.ensureSeasonCached(client, showIdentity.tmdbId, seasonNumber);
        episodes.push(...await this.tmdbCacheService.listEpisodesForSeason(client, showIdentity.tmdbId, seasonNumber));
      }

      const uniqueEpisodes = dedupeEpisodes(episodes).map((episode) => buildEpisodeView(title, episode));
      return {
        show: await this.metadataViewService.buildMetadataView(client, showIdentity),
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
      showId: input.showId ?? episodeList.show.externalIds.imdb,
      nowMs: input.nowMs ?? null,
    });

    return {
      show: episodeList.show,
      currentSeasonNumber: input.currentSeasonNumber,
      currentEpisodeNumber: input.currentEpisodeNumber,
      item: nextEpisode ? episodeList.episodes.find((episode) => episode.id === nextEpisode.id) ?? null : null,
    };
  }

  async getTitleContent(userId: string, id: string): Promise<MetadataTitleContentResponse> {
    const item = await this.resolveMetadataView({ id });
    const imdbId = normalizeImdbId(item.externalIds.imdb);
    if (!imdbId) {
      throw new HttpError(404, 'IMDb id not available for this title.');
    }

    const cachedOmdb = await this.runInTransaction((client) => this.omdbCacheRepository.findByImdbId(client, imdbId));
    if (cachedOmdb) {
      return {
        item,
        omdb: cachedOmdb,
      };
    }

    const omdbApiKeys = await this.getOmdbApiKeys(userId);
    const omdb = await this.fetchOmdbContentFromCandidates(omdbApiKeys, imdbId);
    await this.runInTransaction((client) => this.omdbCacheRepository.upsert(client, imdbId, omdb));
    return {
      item,
      omdb,
    };
  }

  async resolvePlayback(input: ResolveMetadataInput): Promise<PlaybackResolveResponse> {
    return withDbClient(async (client) => {
      const identity = await this.resolveIdentity(client, input);
      const item = await this.metadataViewService.buildMetadataView(client, identity);
      let show: MetadataView | null = null;
      let season: MetadataSeasonView | null = null;

      if (identity.mediaType === 'episode' && identity.showTmdbId) {
        const showIdentity = inferMediaIdentity({ mediaType: 'show', tmdbId: identity.showTmdbId });
        show = await this.metadataViewService.buildMetadataView(client, showIdentity);
        if (identity.seasonNumber !== null) {
          const seasonRecord = await this.tmdbCacheService.ensureSeasonCached(client, identity.showTmdbId, identity.seasonNumber);
          if (seasonRecord) {
            season = buildSeasonViewFromRecord(identity.showTmdbId, seasonRecord);
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

  private async resolveShowIdentity(_client: DbClient, id: string): Promise<MediaIdentity & { mediaType: 'show'; tmdbId: number }> {
    const parsed = parseMetadataId(id);
    if (parsed.mediaType === 'show' && parsed.tmdbId) {
      return {
        ...parsed,
        mediaType: 'show',
        tmdbId: parsed.tmdbId,
      };
    }
    if (parsed.mediaType === 'episode' && parsed.showTmdbId) {
      return {
        mediaKey: `show:tmdb:${parsed.showTmdbId}`,
        mediaType: 'show',
        tmdbId: parsed.showTmdbId,
        showTmdbId: parsed.showTmdbId,
        seasonNumber: null,
        episodeNumber: null,
      };
    }
    throw new HttpError(400, 'Episode listing requires a show id.');
  }

  private async resolveIdentity(client: DbClient, input: ResolveMetadataInput): Promise<MediaIdentity> {
    if (input.id?.trim()) {
      return parseMetadataId(input.id.trim());
    }

    const mediaType = normalizeResolveMediaType(input.mediaType, input.seasonNumber, input.episodeNumber);
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
        mediaType,
      });
    }

    if (typeof input.tvdbId === 'number' && Number.isInteger(input.tvdbId) && input.tvdbId > 0) {
      return this.externalIdResolver.resolve(client, {
        source: 'tvdb_id',
        externalId: String(input.tvdbId),
        mediaType,
      });
    }

    return null;
  }

  private async getOmdbApiKeys(userId: string): Promise<string[]> {
    const lookup = await this.accountSettingsService.listOmdbApiKeysForLookup(userId);
    const candidates = dedupeStrings([
      ...lookup.ownKeys,
      ...rotateRoundRobin(parseStringListEnv('OMDB_API_KEYS'), 'server'),
      ...rotateRoundRobin(lookup.pooledKeys, 'pool'),
    ]);

    if (!candidates.length) {
      throw new HttpError(412, 'OMDb is not configured. Add an OMDb API key in Account Settings or configure server OMDb keys.');
    }

    return candidates;
  }

  private async fetchOmdbContentFromCandidates(apiKeys: string[], imdbId: string): Promise<OmdbContentView> {
    let lastError: HttpError | null = null;

    for (const apiKey of apiKeys) {
      try {
        return await this.fetchOmdbContent(apiKey, imdbId);
      } catch (error) {
        if (error instanceof HttpError) {
          if (error.statusCode === 400 || error.statusCode === 404) {
            throw error;
          }
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError ?? new HttpError(502, 'OMDb lookup failed.');
  }

  private async fetchOmdbContent(apiKey: string, imdbId: string): Promise<OmdbContentView> {
    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('i', imdbId);
    url.searchParams.set('plot', 'full');
    url.searchParams.set('tomatoes', 'true');

    let response: Response;
    try {
      response = await this.fetcher(url.toString(), {
        headers: {
          Accept: 'application/json',
        },
      });
    } catch (error) {
      throw new HttpError(502, 'OMDb request failed.', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    if (!response.ok) {
      throw new HttpError(502, `OMDb request failed with HTTP ${response.status}.`);
    }

    const payload = await response.json().catch(() => null);
    const record = asRecord(payload);
    if (!record) {
      throw new HttpError(502, 'OMDb returned an invalid response.');
    }

    const omdbResponse = asString(record.Response);
    if (omdbResponse?.toLowerCase() === 'false') {
      const message = asString(record.Error) ?? 'OMDb lookup failed.';
      const statusCode = /not found/i.test(message)
        ? 404
        : /incorrect imdb/i.test(message)
          ? 400
          : 502;
      throw new HttpError(statusCode, message);
    }

    return buildOmdbContentView(record, imdbId);
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
  if (mediaType === 'movie' || mediaType === 'show' || mediaType === 'episode') {
    return mediaType;
  }

  if (seasonNumber !== null && seasonNumber !== undefined && episodeNumber !== null && episodeNumber !== undefined) {
    return 'episode';
  }

  return 'movie';
}

function buildKnownForItems(payload: Record<string, unknown>): MetadataPersonKnownForItem[] {
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
      id: buildMetadataId({ mediaType, tmdbId }),
      mediaType,
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

function parsePersonTmdbId(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const direct = asPositiveNumber(trimmed);
  if (direct) {
    return direct;
  }

  const match = trimmed.match(/(\d+)/);
  return match ? asPositiveNumber(match[1]) : null;
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

function buildOmdbContentView(payload: Record<string, unknown>, fallbackImdbId: string): OmdbContentView {
  return {
    imdbId: normalizeImdbId(asString(payload.imdbID)) ?? fallbackImdbId,
    title: asOmdbString(payload.Title),
    type: asOmdbString(payload.Type),
    year: asOmdbString(payload.Year),
    rated: asOmdbString(payload.Rated),
    released: asOmdbString(payload.Released),
    runtime: asOmdbString(payload.Runtime),
    genres: parseOmdbList(payload.Genre),
    directors: parseOmdbList(payload.Director),
    writers: parseOmdbList(payload.Writer),
    actors: parseOmdbList(payload.Actors),
    plot: asOmdbString(payload.Plot),
    languages: parseOmdbList(payload.Language),
    countries: parseOmdbList(payload.Country),
    awards: asOmdbString(payload.Awards),
    posterUrl: asOmdbString(payload.Poster),
    ratings: parseOmdbRatings(payload.Ratings),
    imdbRating: parseOmdbNumber(payload.imdbRating),
    imdbVotes: parseOmdbInteger(payload.imdbVotes),
    metascore: parseOmdbInteger(payload.Metascore),
    boxOffice: asOmdbString(payload.BoxOffice),
    production: asOmdbString(payload.Production),
    website: asOmdbString(payload.Website),
    totalSeasons: parseOmdbInteger(payload.totalSeasons),
  };
}

function parseOmdbList(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && entry.toUpperCase() !== 'N/A')
    : [];
}

function parseOmdbRatings(value: unknown): OmdbRatingEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const source = asOmdbString(entry.Source);
      const ratingValue = asOmdbString(entry.Value);
      if (!source || !ratingValue) {
        return null;
      }
      return {
        source,
        value: ratingValue,
      } satisfies OmdbRatingEntry;
    })
    .filter((entry): entry is OmdbRatingEntry => entry !== null);
}

function parseOmdbNumber(value: unknown): number | null {
  const normalized = asOmdbString(value);
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOmdbInteger(value: unknown): number | null {
  const parsed = parseOmdbNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function asOmdbString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized && normalized.toUpperCase() !== 'N/A' ? normalized : null;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function rotateRoundRobin(values: string[], kind: 'server' | 'pool'): string[] {
  if (values.length <= 1) {
    return [...values];
  }

  const cursor = kind === 'server' ? omdbServerKeyCursor++ : omdbPoolKeyCursor++;
  const startIndex = cursor % values.length;
  return [...values.slice(startIndex), ...values.slice(0, startIndex)];
}
