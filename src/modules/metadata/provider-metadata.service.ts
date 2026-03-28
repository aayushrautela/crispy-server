import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity, SupportedProvider } from '../watch/media-key.js';
import {
  buildAbsoluteEpisodeProviderId,
  buildEpisodeProviderId,
  buildSeasonProviderId,
} from '../watch/media-key.js';
import { KitsuClient } from './kitsu.client.js';
import type {
  MetadataParentMediaType,
  MetadataSearchFilter,
  MetadataExternalIds,
  ProviderEpisodeRecord,
  ProviderSeasonRecord,
  ProviderTitleRecord,
} from './tmdb.types.js';
import { TvdbClient } from './tvdb.client.js';

type ProviderTitleBundle = {
  title: ProviderTitleRecord;
  seasons: ProviderSeasonRecord[];
  episodes: ProviderEpisodeRecord[];
};

export type ProviderIdentityContext = {
  title: ProviderTitleRecord | null;
  currentEpisode: ProviderEpisodeRecord | null;
  nextEpisode: ProviderEpisodeRecord | null;
  seasons: ProviderSeasonRecord[];
  episodes: ProviderEpisodeRecord[];
};

export class ProviderMetadataService {
  constructor(
    private readonly tvdbClient = new TvdbClient(),
    private readonly kitsuClient = new KitsuClient(),
  ) {}

  async searchTitles(
    _client: DbClient,
    query: string,
    filter: MetadataSearchFilter,
    limit: number,
  ): Promise<ProviderTitleRecord[]> {
    const searches: Array<Promise<ProviderTitleRecord[]>> = [];

    if (filter === 'all' || filter === 'series') {
      searches.push(this.searchTvdbSeries(query, limit));
    }

    if (filter === 'all' || filter === 'anime') {
      searches.push(this.searchKitsuAnime(query, limit));
    }

    const results = (await Promise.all(searches)).flat();
    return sortProviderTitles(query, dedupeProviderTitles(results)).slice(0, limit);
  }

  async loadIdentityContext(_client: DbClient, identity: MediaIdentity): Promise<ProviderIdentityContext | null> {
    const bundle = await this.loadBundle(identity);
    if (!bundle) {
      return null;
    }

    const currentEpisode = selectCurrentEpisode(bundle.episodes, identity);
    return {
      title: bundle.title,
      currentEpisode,
      nextEpisode: selectNextEpisode(bundle.episodes, identity, currentEpisode),
      seasons: bundle.seasons,
      episodes: bundle.episodes,
    };
  }

  async loadSeasonContext(
    _client: DbClient,
    identity: MediaIdentity,
    seasonNumber: number,
  ): Promise<{
    title: ProviderTitleRecord | null;
    season: ProviderSeasonRecord | null;
    episodes: ProviderEpisodeRecord[];
    nextEpisode: ProviderEpisodeRecord | null;
  } | null> {
    const context = await this.loadIdentityContext(_client, identity);
    if (!context) {
      return null;
    }

    return {
      title: context.title,
      season: context.seasons.find((entry) => entry.seasonNumber === seasonNumber) ?? null,
      episodes: context.episodes.filter((entry) => entry.seasonNumber === seasonNumber),
      nextEpisode: context.nextEpisode,
    };
  }

  private async searchTvdbSeries(query: string, limit: number): Promise<ProviderTitleRecord[]> {
    const payload = await this.tvdbClient.searchSeries(query, limit);
    return asArray(payload.data)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => normalizeTvdbSearchTitle(entry))
      .filter((entry): entry is ProviderTitleRecord => entry !== null)
      .slice(0, limit);
  }

  private async searchKitsuAnime(query: string, limit: number): Promise<ProviderTitleRecord[]> {
    const payload = await this.kitsuClient.searchAnime(query, limit);
    return asArray(payload.data)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => normalizeKitsuSearchTitle(entry))
      .filter((entry): entry is ProviderTitleRecord => entry !== null)
      .slice(0, limit);
  }

  private async loadBundle(identity: MediaIdentity): Promise<ProviderTitleBundle | null> {
    const titleProvider = resolveTitleProvider(identity);
    if (!titleProvider) {
      return null;
    }

    if (titleProvider.provider === 'tvdb') {
      return this.loadTvdbSeriesBundle(titleProvider.providerId);
    }

    if (titleProvider.provider === 'kitsu') {
      return this.loadKitsuAnimeBundle(titleProvider.providerId);
    }

    return null;
  }

  private async loadTvdbSeriesBundle(seriesId: string): Promise<ProviderTitleBundle> {
    const [seriesPayload, episodesPayload] = await Promise.all([
      this.tvdbClient.fetchSeriesExtended(seriesId),
      this.tvdbClient.fetchSeriesEpisodes(seriesId, 'default').catch(() => ({ data: [] })),
    ]);

    const series = asRecord(seriesPayload.data);
    if (!series) {
      throw new HttpError(404, 'Show metadata not found.');
    }

    const title = normalizeTvdbTitle(seriesPayload, seriesId);
    const episodes = dedupeProviderEpisodes([
      ...extractTvdbEpisodes(seriesPayload, seriesId),
      ...extractTvdbEpisodes(episodesPayload, seriesId),
    ]);
    const seasons = deriveTvdbSeasons(series, seriesId, episodes, title.episodeCount);

    return {
      title: {
        ...title,
        seasonCount: title.seasonCount ?? (seasons.length || null),
        episodeCount: title.episodeCount ?? (episodes.length || null),
      },
      seasons,
      episodes,
    };
  }

  private async loadKitsuAnimeBundle(animeId: string): Promise<ProviderTitleBundle> {
    const [animePayload, episodesPayload] = await Promise.all([
      this.kitsuClient.fetchAnime(animeId),
      this.kitsuClient.fetchAnimeEpisodes(animeId, 100).catch(() => ({ data: [] })),
    ]);

    const anime = asRecord(animePayload.data);
    if (!anime) {
      throw new HttpError(404, 'Anime metadata not found.');
    }

    const included = asArray(animePayload.included);
    const title = normalizeKitsuTitle(animePayload, animeId);
    const episodes = dedupeProviderEpisodes([
      ...extractKitsuEpisodesFromIncluded(included, animeId),
      ...extractKitsuEpisodesFromPayload(episodesPayload, animeId),
    ]);
    const seasons = deriveKitsuSeasons(anime, animeId, episodes);

    return {
      title: {
        ...title,
        seasonCount: title.seasonCount ?? (seasons.length || null),
        episodeCount: title.episodeCount ?? (episodes.length || null),
      },
      seasons,
      episodes,
    };
  }
}

function resolveTitleProvider(identity: MediaIdentity): { provider: SupportedProvider; providerId: string } | null {
  if (identity.mediaType === 'show' || identity.mediaType === 'anime' || identity.mediaType === 'movie') {
    return identity.provider && identity.providerId
      ? { provider: identity.provider, providerId: identity.providerId }
      : null;
  }

  if ((identity.mediaType === 'season' || identity.mediaType === 'episode') && identity.parentProvider && identity.parentProviderId) {
    return {
      provider: identity.parentProvider,
      providerId: identity.parentProviderId,
    };
  }

  return null;
}

function selectCurrentEpisode(episodes: ProviderEpisodeRecord[], identity: MediaIdentity): ProviderEpisodeRecord | null {
  if (identity.mediaType !== 'episode') {
    return null;
  }

  if (identity.absoluteEpisodeNumber !== null && identity.absoluteEpisodeNumber !== undefined) {
    return episodes.find((episode) => episode.absoluteEpisodeNumber === identity.absoluteEpisodeNumber) ?? null;
  }

  if (identity.seasonNumber !== null && identity.episodeNumber !== null) {
    return episodes.find((episode) => (
      episode.seasonNumber === identity.seasonNumber
      && episode.episodeNumber === identity.episodeNumber
    )) ?? null;
  }

  return null;
}

function selectNextEpisode(
  episodes: ProviderEpisodeRecord[],
  identity: MediaIdentity,
  currentEpisode: ProviderEpisodeRecord | null,
): ProviderEpisodeRecord | null {
  const sorted = [...episodes].sort(compareEpisodes);

  if (currentEpisode) {
    const currentIndex = sorted.findIndex((episode) => episode.providerId === currentEpisode.providerId);
    return currentIndex >= 0 ? sorted[currentIndex + 1] ?? null : null;
  }

  if (identity.mediaType === 'show' || identity.mediaType === 'anime') {
    const now = Date.now();
    return sorted.find((episode) => {
      const airDate = episode.airDate?.trim();
      return airDate ? Date.parse(airDate) >= now : false;
    }) ?? null;
  }

  return null;
}

function compareEpisodes(left: ProviderEpisodeRecord, right: ProviderEpisodeRecord): number {
  const leftSeason = left.seasonNumber ?? 0;
  const rightSeason = right.seasonNumber ?? 0;
  if (leftSeason !== rightSeason) {
    return leftSeason - rightSeason;
  }

  const leftEpisode = left.episodeNumber ?? left.absoluteEpisodeNumber ?? 0;
  const rightEpisode = right.episodeNumber ?? right.absoluteEpisodeNumber ?? 0;
  return leftEpisode - rightEpisode;
}

function dedupeProviderTitles(records: ProviderTitleRecord[]): ProviderTitleRecord[] {
  const seen = new Set<string>();
  const deduped: ProviderTitleRecord[] = [];
  for (const record of records) {
    const key = `${record.mediaType}:${record.provider}:${record.providerId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

function sortProviderTitles(query: string, records: ProviderTitleRecord[]): ProviderTitleRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  return [...records].sort((left, right) => {
    const leftRank = rankTitle(normalizedQuery, left.title, left.originalTitle);
    const rightRank = rankTitle(normalizedQuery, right.title, right.originalTitle);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return (right.rating ?? 0) - (left.rating ?? 0);
  });
}

function rankTitle(query: string, ...candidates: Array<string | null>): number {
  if (!query) {
    return 4;
  }

  const normalizedCandidates = candidates
    .map((candidate) => candidate?.trim().toLowerCase() ?? null)
    .filter((candidate): candidate is string => Boolean(candidate));

  if (normalizedCandidates.some((candidate) => candidate === query)) {
    return 0;
  }
  if (normalizedCandidates.some((candidate) => candidate.startsWith(query))) {
    return 1;
  }
  if (normalizedCandidates.some((candidate) => candidate.includes(query))) {
    return 2;
  }
  return 3;
}

function dedupeProviderEpisodes(episodes: ProviderEpisodeRecord[]): ProviderEpisodeRecord[] {
  const seen = new Set<string>();
  return [...episodes]
    .filter((episode) => {
      const key = `${episode.parentProvider}:${episode.parentProviderId}:${episode.providerId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort(compareEpisodes);
}

function deriveTvdbSeasons(
  series: Record<string, unknown>,
  seriesId: string,
  episodes: ProviderEpisodeRecord[],
  episodeCount: number | null,
): ProviderSeasonRecord[] {
  const seasonMap = new Map<number, ProviderSeasonRecord>();
  for (const entry of asArray(series.seasons)) {
    const season = asRecord(entry);
    const seasonNumber = asInteger(season?.number) ?? asInteger(season?.seasonNumber);
    if (seasonNumber === null) {
      continue;
    }
    seasonMap.set(seasonNumber, {
      provider: 'tvdb',
      providerId: buildSeasonProviderId(seriesId, seasonNumber),
      parentMediaType: 'show',
      parentProvider: 'tvdb',
      parentProviderId: seriesId,
      seasonNumber,
      title: asString(season?.name) ?? `Season ${seasonNumber}`,
      summary: asString(season?.overview),
      airDate: asString(season?.year) ?? asString(season?.firstAired),
      episodeCount: null,
      posterUrl: asString(season?.image),
      raw: season ?? {},
    });
  }

  for (const episode of episodes) {
    const seasonNumber = episode.seasonNumber ?? 1;
    const current = seasonMap.get(seasonNumber);
    const count = (current?.episodeCount ?? 0) + 1;
    seasonMap.set(seasonNumber, {
      provider: 'tvdb',
      providerId: current?.providerId ?? buildSeasonProviderId(seriesId, seasonNumber),
      parentMediaType: 'show',
      parentProvider: 'tvdb',
      parentProviderId: seriesId,
      seasonNumber,
      title: current?.title ?? `Season ${seasonNumber}`,
      summary: current?.summary ?? null,
      airDate: current?.airDate ?? episode.airDate,
      episodeCount: count,
      posterUrl: current?.posterUrl ?? null,
      raw: current?.raw ?? {},
    });
  }

  if (!seasonMap.size && episodeCount) {
    seasonMap.set(1, {
      provider: 'tvdb',
      providerId: buildSeasonProviderId(seriesId, 1),
      parentMediaType: 'show',
      parentProvider: 'tvdb',
      parentProviderId: seriesId,
      seasonNumber: 1,
      title: 'Season 1',
      summary: null,
      airDate: null,
      episodeCount,
      posterUrl: asString(series.image),
      raw: {},
    });
  }

  return [...seasonMap.values()].sort((left, right) => left.seasonNumber - right.seasonNumber);
}

function deriveKitsuSeasons(
  anime: Record<string, unknown>,
  animeId: string,
  episodes: ProviderEpisodeRecord[],
): ProviderSeasonRecord[] {
  const seasonMap = new Map<number, ProviderSeasonRecord>();
  for (const episode of episodes) {
    const seasonNumber = episode.seasonNumber ?? 1;
    const current = seasonMap.get(seasonNumber);
    seasonMap.set(seasonNumber, {
      provider: 'kitsu',
      providerId: current?.providerId ?? buildSeasonProviderId(animeId, seasonNumber),
      parentMediaType: 'anime',
      parentProvider: 'kitsu',
      parentProviderId: animeId,
      seasonNumber,
      title: current?.title ?? `Season ${seasonNumber}`,
      summary: current?.summary ?? null,
      airDate: current?.airDate ?? episode.airDate,
      episodeCount: (current?.episodeCount ?? 0) + 1,
      posterUrl: current?.posterUrl ?? extractKitsuImageUrl(asRecord(asRecord(anime.attributes)?.posterImage)),
      raw: current?.raw ?? {},
    });
  }

  if (!seasonMap.size) {
    seasonMap.set(1, {
      provider: 'kitsu',
      providerId: buildSeasonProviderId(animeId, 1),
      parentMediaType: 'anime',
      parentProvider: 'kitsu',
      parentProviderId: animeId,
      seasonNumber: 1,
      title: 'Season 1',
      summary: null,
      airDate: asString(asRecord(anime.attributes)?.startDate),
      episodeCount: asInteger(asRecord(anime.attributes)?.episodeCount),
      posterUrl: extractKitsuImageUrl(asRecord(asRecord(anime.attributes)?.posterImage)),
      raw: {},
    });
  }

  return [...seasonMap.values()].sort((left, right) => left.seasonNumber - right.seasonNumber);
}

function extractTvdbEpisodes(payload: Record<string, unknown>, seriesId: string): ProviderEpisodeRecord[] {
  const records = [
    ...asArray(asRecord(payload.data)?.episodes),
    ...asArray(asRecord(asRecord(payload.data)?.episodes)?.data),
    ...asArray(payload.data),
  ];

  return records
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => normalizeTvdbEpisode(entry, seriesId))
    .filter((entry): entry is ProviderEpisodeRecord => entry !== null);
}

function extractKitsuEpisodesFromIncluded(included: unknown[], animeId: string): ProviderEpisodeRecord[] {
  return included
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => asString(entry.type) === 'episodes')
    .map((entry) => normalizeKitsuEpisode(entry, animeId))
    .filter((entry): entry is ProviderEpisodeRecord => entry !== null);
}

function extractKitsuEpisodesFromPayload(payload: Record<string, unknown>, animeId: string): ProviderEpisodeRecord[] {
  return asArray(payload.data)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => normalizeKitsuEpisode(entry, animeId))
    .filter((entry): entry is ProviderEpisodeRecord => entry !== null);
}

function normalizeTvdbSearchTitle(record: Record<string, unknown>): ProviderTitleRecord | null {
  const id = asString(record.tvdb_id) ?? asString(record.id);
  const title = asString(record.name);
  if (!id || !title) {
    return null;
  }

  return {
    mediaType: 'show',
    provider: 'tvdb',
    providerId: id,
    title,
    originalTitle: asString(record.translatedName) ?? title,
    summary: asString(record.overview),
    overview: asString(record.overview),
    releaseDate: asString(record.first_air_time) ?? asString(record.year),
    status: asString(record.status),
    posterUrl: asString(record.image_url) ?? asString(record.image) ?? asString(record.thumbnail),
    backdropUrl: asString(record.image) ?? asString(record.banner),
    logoUrl: null,
    runtimeMinutes: null,
    rating: null,
    certification: null,
    genres: [],
    externalIds: {
      tmdb: null,
      imdb: null,
      tvdb: asInteger(id),
      kitsu: null,
    },
    seasonCount: null,
    episodeCount: null,
    raw: record,
  };
}

function normalizeTvdbTitle(payload: Record<string, unknown>, seriesId: string): ProviderTitleRecord {
  const data = asRecord(payload.data) ?? {};
  return {
    mediaType: 'show',
    provider: 'tvdb',
    providerId: asString(data.id) ?? seriesId,
    title: asString(data.name),
    originalTitle: asString(data.originalName) ?? asString(data.name),
    summary: asString(data.overview),
    overview: asString(data.overview),
    releaseDate: asString(data.firstAired) ?? asString(data.year),
    status: asString(asRecord(data.status)?.name) ?? asString(data.status),
    posterUrl: asString(data.image),
    backdropUrl: asString(data.image),
    logoUrl: null,
    runtimeMinutes: asInteger(data.averageRuntime) ?? asInteger(data.runtime),
    rating: asFloat(data.score),
    certification: asString(data.contentRating),
    genres: asArray(data.genres)
      .map((entry) => asString(asRecord(entry)?.name))
      .filter((entry): entry is string => Boolean(entry)),
    externalIds: extractTvdbExternalIds(data, seriesId),
    seasonCount: asArray(data.seasons).length || null,
    episodeCount: asInteger(data.episodeCount),
    raw: payload,
  };
}

function normalizeTvdbEpisode(record: Record<string, unknown>, seriesId: string): ProviderEpisodeRecord | null {
  const seasonNumber = asInteger(record.seasonNumber) ?? asInteger(record.airedSeason) ?? 1;
  const episodeNumber = asInteger(record.number) ?? asInteger(record.episodeNumber) ?? asInteger(record.absoluteNumber);
  if (episodeNumber === null) {
    return null;
  }

  const absoluteEpisodeNumber = asInteger(record.absoluteNumber);
  return {
    mediaType: 'episode',
    provider: 'tvdb',
    providerId: buildEpisodeProviderId(seriesId, seasonNumber, episodeNumber),
    parentMediaType: 'show',
    parentProvider: 'tvdb',
    parentProviderId: seriesId,
    seasonNumber,
    episodeNumber,
    absoluteEpisodeNumber,
    title: asString(record.name),
    summary: asString(record.overview),
    airDate: asString(record.aired) ?? asString(record.firstAired),
    runtimeMinutes: asInteger(record.runtime),
    rating: asFloat(record.score),
    stillUrl: asString(record.image),
    raw: record,
  };
}

function normalizeKitsuSearchTitle(record: Record<string, unknown>): ProviderTitleRecord | null {
  const id = asString(record.id);
  const attributes = asRecord(record.attributes);
  const title = extractKitsuTitle(attributes);
  if (!id || !title) {
    return null;
  }

  return {
    mediaType: 'anime',
    provider: 'kitsu',
    providerId: id,
    title,
    originalTitle: extractKitsuOriginalTitle(attributes),
    summary: asString(attributes?.synopsis) ?? asString(attributes?.description),
    overview: asString(attributes?.description) ?? asString(attributes?.synopsis),
    releaseDate: asString(attributes?.startDate),
    status: asString(attributes?.status),
    posterUrl: extractKitsuImageUrl(asRecord(attributes?.posterImage)),
    backdropUrl: extractKitsuImageUrl(asRecord(attributes?.coverImage)),
    logoUrl: null,
    runtimeMinutes: asInteger(attributes?.episodeLength),
    rating: asFloat(attributes?.averageRating),
    certification: asString(attributes?.ageRatingGuide) ?? asString(attributes?.ageRating),
    genres: [],
    externalIds: {
      tmdb: null,
      imdb: null,
      tvdb: null,
      kitsu: id,
    },
    seasonCount: null,
    episodeCount: asInteger(attributes?.episodeCount),
    raw: record,
  };
}

function normalizeKitsuTitle(payload: Record<string, unknown>, animeId: string): ProviderTitleRecord {
  const data = asRecord(payload.data) ?? {};
  const attributes = asRecord(data.attributes) ?? {};
  const included = asArray(payload.included);
  return {
    mediaType: 'anime',
    provider: 'kitsu',
    providerId: asString(data.id) ?? animeId,
    title: extractKitsuTitle(attributes),
    originalTitle: extractKitsuOriginalTitle(attributes),
    summary: asString(attributes.synopsis) ?? asString(attributes.description),
    overview: asString(attributes.description) ?? asString(attributes.synopsis),
    releaseDate: asString(attributes.startDate),
    status: asString(attributes.status),
    posterUrl: extractKitsuImageUrl(asRecord(attributes.posterImage)),
    backdropUrl: extractKitsuImageUrl(asRecord(attributes.coverImage)),
    logoUrl: null,
    runtimeMinutes: asInteger(attributes.episodeLength),
    rating: asFloat(attributes.averageRating),
    certification: asString(attributes.ageRatingGuide) ?? asString(attributes.ageRating),
    genres: extractKitsuCategories(included),
    externalIds: extractKitsuExternalIds(included, animeId),
    seasonCount: null,
    episodeCount: asInteger(attributes.episodeCount),
    raw: payload,
  };
}

function normalizeKitsuEpisode(record: Record<string, unknown>, animeId: string): ProviderEpisodeRecord | null {
  const attributes = asRecord(record.attributes);
  const absoluteEpisodeNumber = asInteger(attributes?.number);
  const seasonNumber = asInteger(attributes?.seasonNumber) ?? 1;
  const episodeNumber = asInteger(attributes?.relativeNumber) ?? absoluteEpisodeNumber;
  if (episodeNumber === null) {
    return null;
  }

  const providerId = absoluteEpisodeNumber !== null && (attributes?.seasonNumber === null || attributes?.seasonNumber === undefined)
    ? buildAbsoluteEpisodeProviderId(animeId, absoluteEpisodeNumber)
    : buildEpisodeProviderId(animeId, seasonNumber, episodeNumber);

  return {
    mediaType: 'episode',
    provider: 'kitsu',
    providerId,
    parentMediaType: 'anime',
    parentProvider: 'kitsu',
    parentProviderId: animeId,
    seasonNumber,
    episodeNumber,
    absoluteEpisodeNumber,
    title: extractKitsuTitle(attributes),
    summary: asString(attributes?.synopsis) ?? asString(attributes?.description),
    airDate: asString(attributes?.airdate),
    runtimeMinutes: asInteger(attributes?.length),
    rating: null,
    stillUrl: extractKitsuImageUrl(asRecord(attributes?.thumbnail)),
    raw: record,
  };
}

function extractTvdbExternalIds(data: Record<string, unknown>, seriesId: string): MetadataExternalIds {
  const remoteIds = asArray(data.remoteIds ?? data.remote_ids)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const imdb = findRemoteId(remoteIds, ['imdb']);
  const tmdb = asInteger(findRemoteId(remoteIds, ['themoviedb', 'tmdb']));
  return {
    tmdb,
    imdb,
    tvdb: asInteger(data.id) ?? asInteger(seriesId),
    kitsu: null,
  };
}

function extractKitsuExternalIds(included: unknown[], animeId: string): MetadataExternalIds {
  const mappings = included
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => asString(entry.type) === 'mappings');

  const externalIds: MetadataExternalIds = {
    tmdb: null,
    imdb: null,
    tvdb: null,
    kitsu: animeId,
  };

  for (const mapping of mappings) {
    const attributes = asRecord(mapping.attributes);
    const site = asString(attributes?.externalSite)?.toLowerCase();
    const externalId = asString(attributes?.externalId);
    if (!site || !externalId) {
      continue;
    }
    if (site.includes('imdb')) {
      externalIds.imdb = externalId;
    }
    if (site.includes('themoviedb') || site === 'tmdb') {
      externalIds.tmdb = asInteger(externalId);
    }
    if (site.includes('tvdb')) {
      externalIds.tvdb = asInteger(externalId);
    }
  }

  return externalIds;
}

function extractKitsuCategories(included: unknown[]): string[] {
  return included
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => asString(entry.type) === 'categories')
    .map((entry) => asString(asRecord(entry.attributes)?.title))
    .filter((entry): entry is string => Boolean(entry));
}

function findRemoteId(records: Record<string, unknown>[], sources: string[]): string | null {
  for (const record of records) {
    const source = asString(record.sourceName ?? record.type ?? record.source)?.toLowerCase() ?? '';
    if (!sources.some((candidate) => source.includes(candidate))) {
      continue;
    }

    const externalId = asString(record.remoteId ?? record.sourceId ?? record.value ?? record.id);
    if (externalId) {
      return externalId;
    }
  }

  return null;
}

function extractKitsuTitle(attributes: Record<string, unknown> | null): string | null {
  if (!attributes) {
    return null;
  }
  return asString(attributes.canonicalTitle)
    ?? preferredKitsuTitle(asRecord(attributes.titles))
    ?? firstString(asArray(attributes.abbreviatedTitles));
}

function extractKitsuOriginalTitle(attributes: Record<string, unknown> | null): string | null {
  if (!attributes) {
    return null;
  }
  return preferredKitsuTitle(asRecord(attributes.titles))
    ?? asString(attributes.canonicalTitle);
}

function preferredKitsuTitle(titles: Record<string, unknown> | null): string | null {
  if (!titles) {
    return null;
  }

  return asString(titles.en)
    ?? asString(titles.en_us)
    ?? asString(titles.en_jp)
    ?? asString(titles.ja_jp)
    ?? firstString(Object.values(titles));
}

function extractKitsuImageUrl(record: Record<string, unknown> | null): string | null {
  if (!record) {
    return null;
  }
  return asString(record.original)
    ?? asString(record.large)
    ?? asString(record.medium)
    ?? asString(record.small)
    ?? asString(record.tiny);
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    const candidate = asString(value);
    if (candidate) {
      return candidate;
    }
  }
  return null;
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

function asInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

function asFloat(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
