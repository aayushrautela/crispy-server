import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity, SupportedProvider } from '../identity/media-key.js';
import {
  buildAbsoluteEpisodeProviderId,
  buildEpisodeProviderId,
  buildSeasonProviderId,
} from '../identity/media-key.js';
import { ImdbRatingsService, imdbRatingsService } from './enrichment/imdb-ratings.service.js';
import {
  buildMetadataImages,
  extractCast,
  extractCertification,
  extractCreators,
  extractCrewByJob,
  extractProduction,
  extractRating,
  extractVideos,
} from './metadata-builder.shared.js';
import { KitsuClient } from './providers/kitsu.client.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import { TmdbExternalIdResolverService } from './providers/tmdb-external-id-resolver.service.js';
import type {
  MetadataCollectionView,
  MetadataCompanyView,
  MetadataPersonRefView,
  MetadataProductionInfoView,
  MetadataReviewView,
  MetadataSearchFilter,
  MetadataVideoView,
  ProviderTitleRecord,
} from './metadata-detail.types.js';
import type {
  MetadataExternalIds,
  MetadataParentMediaType,
  ProviderEpisodeRecord,
  ProviderSeasonRecord,
} from './metadata-card.types.js';
import type { TmdbTitleRecord } from './providers/tmdb.types.js';
import { TvdbClient } from './providers/tvdb.client.js';

type ProviderTitleBundle = {
  title: ProviderTitleRecord;
  seasons: ProviderSeasonRecord[];
  episodes: ProviderEpisodeRecord[];
  extras?: {
    characters?: Record<string, unknown> | null;
    staff?: Record<string, unknown> | null;
    relationships?: Record<string, unknown> | null;
    productions?: Record<string, unknown> | null;
    reviews?: Record<string, unknown> | null;
  };
};

export type ProviderIdentityContext = {
  title: ProviderTitleRecord | null;
  currentEpisode: ProviderEpisodeRecord | null;
  nextEpisode: ProviderEpisodeRecord | null;
  seasons: ProviderSeasonRecord[];
  episodes: ProviderEpisodeRecord[];
  videos: MetadataVideoView[];
  cast: MetadataPersonRefView[];
  directors: MetadataPersonRefView[];
  creators: MetadataPersonRefView[];
  reviews: MetadataReviewView[];
  production: MetadataProductionInfoView | null;
  collection: MetadataCollectionView | null;
  similar: Array<ProviderTitleRecord>;
};

export class ProviderMetadataService {
  constructor(
    private readonly tvdbClient = new TvdbClient(),
    private readonly kitsuClient = new KitsuClient(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly tmdbExternalIds = new TmdbExternalIdResolverService(),
    private readonly imdbRatings: ImdbRatingsService = imdbRatingsService,
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

  async loadIdentityContext(
    client: DbClient,
    identity: MediaIdentity,
    language?: string | null,
  ): Promise<ProviderIdentityContext | null> {
    const bundle = await this.loadBundle(identity, language ?? null);
    if (!bundle) {
      return null;
    }

    const tmdbFallbackTitle = bundle.title.provider === 'tvdb'
      ? await this.loadTvdbFallbackTitle(client, bundle.title)
      : null;
    const title = bundle.title.provider === 'tvdb'
      ? await this.enrichTvdbTitle(client, bundle.title, tmdbFallbackTitle)
      : bundle.title;

    const currentEpisode = selectCurrentEpisode(bundle.episodes, identity);
    return {
      title,
      currentEpisode,
      nextEpisode: selectNextEpisode(bundle.episodes, identity, currentEpisode),
      seasons: bundle.seasons,
      episodes: bundle.episodes,
      videos: buildProviderVideos(title, tmdbFallbackTitle, language ?? null),
      cast: buildProviderCast(title, bundle.extras, tmdbFallbackTitle),
      directors: buildProviderCrew(title, bundle.extras, ['director'], tmdbFallbackTitle),
      creators: buildProviderCrew(title, bundle.extras, ['creator', 'writer', 'author'], tmdbFallbackTitle),
      reviews: buildProviderReviews(title, bundle.extras),
      production: buildProviderProduction(title, bundle.extras, tmdbFallbackTitle),
      collection: buildProviderCollection(title),
      similar: buildProviderSimilar(title, bundle.extras),
    };
  }

  async loadSeasonContext(
    _client: DbClient,
    identity: MediaIdentity,
    seasonNumber: number,
    language?: string | null,
  ): Promise<{
    title: ProviderTitleRecord | null;
    season: ProviderSeasonRecord | null;
    episodes: ProviderEpisodeRecord[];
    nextEpisode: ProviderEpisodeRecord | null;
  } | null> {
    const context = await this.loadIdentityContext(_client, identity, language ?? null);
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

  private async loadBundle(identity: MediaIdentity, language?: string | null): Promise<ProviderTitleBundle | null> {
    const titleProvider = resolveTitleProvider(identity);
    if (!titleProvider) {
      return null;
    }

    if (titleProvider.provider === 'tvdb') {
      return this.loadTvdbSeriesBundle(titleProvider.providerId, language ?? null);
    }

    if (titleProvider.provider === 'kitsu') {
      return this.loadKitsuAnimeBundle(titleProvider.providerId);
    }

    return null;
  }

  private async loadTvdbSeriesBundle(seriesId: string, language?: string | null): Promise<ProviderTitleBundle> {
    const [seriesPayload, episodesPayload] = await Promise.all([
      this.tvdbClient.fetchSeriesExtended(seriesId),
      this.tvdbClient.fetchSeriesEpisodes(seriesId, 'default').catch(() => ({ data: [] })),
    ]);

    const series = asRecord(seriesPayload.data);
    if (!series) {
      throw new HttpError(404, 'Show metadata not found.');
    }

    const title = normalizeTvdbTitle(seriesPayload, seriesId, language ?? null);
    const episodes = dedupeProviderEpisodes([
      ...extractTvdbEpisodes(seriesPayload, seriesId, language ?? null),
      ...extractTvdbEpisodes(episodesPayload, seriesId, language ?? null),
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
    const [animePayload, episodesPayload, charactersPayload, staffPayload, relationshipsPayload, productionsPayload, reviewsPayload] = await Promise.all([
      this.kitsuClient.fetchAnime(animeId),
      this.fetchAllKitsuEpisodes(animeId).catch(() => ({ data: [] })),
      this.kitsuClient.fetchAnimeCharacters(animeId).catch(() => ({ data: [], included: [] })),
      this.kitsuClient.fetchAnimeStaff(animeId).catch(() => ({ data: [], included: [] })),
      this.kitsuClient.fetchAnimeRelationships(animeId).catch(() => ({ data: [], included: [] })),
      this.kitsuClient.fetchAnimeProductions(animeId).catch(() => ({ data: [] })),
      this.kitsuClient.fetchAnimeReviews(animeId).catch(() => ({ data: [] })),
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
      extras: {
        characters: charactersPayload,
        staff: staffPayload,
        relationships: relationshipsPayload,
        productions: productionsPayload,
        reviews: reviewsPayload,
      },
    };
  }

  private async fetchAllKitsuEpisodes(animeId: string): Promise<Record<string, unknown>> {
    const data: unknown[] = [];
    let offset = 0;
    const pageSize = 20;

    for (;;) {
      const payload = await this.kitsuClient.fetchAnimeEpisodes(animeId, pageSize, offset);
      const page = asArray(payload.data);
      if (!page.length) {
        break;
      }
      data.push(...page);
      if (page.length < pageSize) {
        break;
      }
      offset += page.length;
    }

    return { data };
  }

  private async loadTvdbFallbackTitle(client: DbClient, title: ProviderTitleRecord): Promise<TmdbTitleRecord | null> {
    let tmdbId = title.externalIds.tmdb;

    if (!tmdbId && title.externalIds.imdb) {
      tmdbId = await this.tmdbExternalIds.resolve(client, {
        source: 'imdb_id',
        externalId: title.externalIds.imdb,
        mediaType: title.mediaType === 'movie' ? 'movie' : 'show',
      });
    }

    if (!tmdbId && title.externalIds.tvdb) {
      tmdbId = await this.tmdbExternalIds.resolve(client, {
        source: 'tvdb_id',
        externalId: String(title.externalIds.tvdb),
        mediaType: title.mediaType === 'movie' ? 'movie' : 'show',
      });
    }

    if (!tmdbId) {
      return null;
    }

    return this.tmdbCacheService.ensureTitleCached(client, title.mediaType === 'movie' ? 'movie' : 'tv', tmdbId).catch(() => null);
  }

  private async enrichTvdbTitle(
    client: DbClient,
    title: ProviderTitleRecord,
    tmdbTitle: TmdbTitleRecord | null,
  ): Promise<ProviderTitleRecord> {
    const tmdbImages = tmdbTitle ? buildMetadataImages(tmdbTitle, null) : null;
    const externalIds = {
      ...title.externalIds,
      tmdb: tmdbTitle?.tmdbId ?? title.externalIds.tmdb,
      imdb: title.externalIds.imdb ?? asString(tmdbTitle?.externalIds.imdb_id),
    };

    let rating = title.rating;
    if (rating === null && externalIds.imdb) {
      const imdbRating = await this.imdbRatings.getRating(client, externalIds.imdb);
      if (imdbRating) {
        rating = imdbRating.rating;
      }
    }
    if (rating === null && tmdbTitle) {
      rating = extractRating(tmdbTitle, null);
    }

    return {
      ...title,
      externalIds,
      posterUrl: title.posterUrl ?? tmdbImages?.posterUrl ?? null,
      backdropUrl: title.backdropUrl ?? tmdbImages?.backdropUrl ?? null,
      logoUrl: title.logoUrl ?? tmdbImages?.logoUrl ?? null,
      rating,
      certification: title.certification ?? (tmdbTitle ? extractCertification(tmdbTitle) : null),
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

function extractTvdbEpisodes(payload: Record<string, unknown>, seriesId: string, language?: string | null): ProviderEpisodeRecord[] {
  const records = [
    ...asArray(asRecord(payload.data)?.episodes),
    ...asArray(asRecord(asRecord(payload.data)?.episodes)?.data),
    ...asArray(payload.data),
  ];

  return records
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => normalizeTvdbEpisode(entry, seriesId, language ?? null))
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

export function normalizeTvdbSearchTitle(record: Record<string, unknown>): ProviderTitleRecord | null {
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
    posterUrl: normalizeTvdbImageUrl(asString(record.image_url) ?? asString(record.image) ?? asString(record.thumbnail)),
    backdropUrl: normalizeTvdbImageUrl(asString(record.banner)),
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

export function normalizeTvdbTitle(payload: Record<string, unknown>, seriesId: string, language?: string | null): ProviderTitleRecord {
  const data = asRecord(payload.data) ?? {};
  const artworks = asArray(data.artworks)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const preferredLanguage = normalizeLanguagePreference(language ?? null);

  return {
    mediaType: 'show',
    provider: 'tvdb',
    providerId: asString(data.id) ?? seriesId,
    title: extractTvdbTranslatedText(data, 'name', preferredLanguage.tvdb) ?? asString(data.name),
    originalTitle: asString(data.originalName) ?? asString(data.name),
    summary: extractTvdbTranslatedText(data, 'overview', preferredLanguage.tvdb) ?? asString(data.overview),
    overview: extractTvdbTranslatedText(data, 'overview', preferredLanguage.tvdb) ?? asString(data.overview),
    releaseDate: asString(data.firstAired) ?? asString(data.year),
    status: asString(asRecord(data.status)?.name) ?? asString(data.status),
    posterUrl: extractTvdbArtworkUrl(artworks, ['poster'], preferredLanguage.tvdb) ?? normalizeTvdbImageUrl(asString(data.image)),
    backdropUrl: extractTvdbArtworkUrl(artworks, ['background'], preferredLanguage.tvdb),
    logoUrl: extractTvdbArtworkUrl(artworks, ['clearlogo'], preferredLanguage.tvdb),
    runtimeMinutes: asInteger(data.averageRuntime) ?? asInteger(data.runtime),
    rating: null,
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

export function normalizeTvdbEpisode(record: Record<string, unknown>, seriesId: string, language?: string | null): ProviderEpisodeRecord | null {
  const seasonNumber = asInteger(record.seasonNumber) ?? asInteger(record.airedSeason) ?? 1;
  const episodeNumber = asInteger(record.number) ?? asInteger(record.episodeNumber) ?? asInteger(record.absoluteNumber);
  if (episodeNumber === null) {
    return null;
  }

  const absoluteEpisodeNumber = asInteger(record.absoluteNumber);
  const preferredLanguage = normalizeLanguagePreference(language ?? null);
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
    title: extractTvdbTranslatedText(record, 'name', preferredLanguage.tvdb) ?? asString(record.name),
    summary: extractTvdbTranslatedText(record, 'overview', preferredLanguage.tvdb) ?? asString(record.overview),
    airDate: asString(record.aired) ?? asString(record.firstAired),
    runtimeMinutes: asInteger(record.runtime),
    rating: null,
    stillUrl: normalizeTvdbImageUrl(asString(record.image)),
    raw: record,
  };
}

export function normalizeKitsuSearchTitle(record: Record<string, unknown>): ProviderTitleRecord | null {
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
    rating: normalizeKitsuRating(attributes?.averageRating),
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

export function normalizeKitsuTitle(payload: Record<string, unknown>, animeId: string): ProviderTitleRecord {
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
    rating: normalizeKitsuRating(attributes.averageRating),
    certification: asString(attributes.ageRatingGuide) ?? asString(attributes.ageRating),
    genres: extractKitsuCategories(included),
    externalIds: extractKitsuExternalIds(included, animeId),
    seasonCount: null,
    episodeCount: asInteger(attributes.episodeCount),
    raw: payload,
  };
}

export function normalizeKitsuEpisode(record: Record<string, unknown>, animeId: string): ProviderEpisodeRecord | null {
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

export function buildProviderVideos(
  title: ProviderTitleRecord,
  tmdbTitle?: TmdbTitleRecord | null,
  language?: string | null,
): MetadataVideoView[] {
  if (title.provider === 'tvdb') {
    const preferredLanguage = normalizeLanguagePreference(language ?? null);
    const trailers = rankTvdbTrailers(
      asArray(asRecord(asRecord(title.raw)?.data)?.trailers)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null),
      preferredLanguage,
    )
      .flatMap((entry) => {
        const id = asString(entry.id) ?? asString(entry.url);
        const url = asString(entry.url);
        if (!id || !url) {
          return [];
        }

        return [{
          id,
          key: url,
          name: asString(entry.name),
          site: 'TVDB',
          type: 'Trailer',
          official: true,
          publishedAt: null,
          url,
          thumbnailUrl: normalizeTvdbImageUrl(asString(entry.thumbnail) ?? asString(entry.image)),
        } satisfies MetadataVideoView];
      });

    if (trailers.length) {
      return trailers;
    }

    return tmdbTitle ? rankTmdbVideos(extractVideos(tmdbTitle), tmdbTitle, preferredLanguage) : [];
  }

  if (title.provider === 'kitsu') {
    const attributes = asRecord(asRecord(title.raw)?.data)?.attributes;
    const key = asString(asRecord(attributes)?.youtubeVideoId);
    if (!key) {
      return [];
    }

    return [{
      id: key,
      key,
      name: title.title,
      site: 'YouTube',
      type: 'Trailer',
      official: true,
      publishedAt: null,
      url: `https://www.youtube.com/watch?v=${key}`,
      thumbnailUrl: `https://img.youtube.com/vi/${key}/hqdefault.jpg`,
    } satisfies MetadataVideoView];
  }

  return [];
}

export function buildProviderCast(
  title: ProviderTitleRecord,
  extras?: ProviderTitleBundle['extras'],
  tmdbTitle?: TmdbTitleRecord | null,
): MetadataPersonRefView[] {
  if (title.provider !== 'tvdb') {
    return buildKitsuCast(extras);
  }

  const cast = asArray(asRecord(asRecord(title.raw)?.data)?.characters)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .flatMap((entry) => {
      const providerId = asString(entry.peopleId) ?? asString(entry.id);
      const name = asString(entry.personName) ?? asString(entry.name);
      if (!providerId || !name) {
        return [];
      }

      return [{
        id: `person:tvdb:${providerId}`,
        provider: 'tvdb' as const,
        providerId,
        tmdbPersonId: null,
        name,
        role: asString(entry.name),
        department: asString(entry.peopleType) ?? 'Cast',
          profileUrl: asString(entry.personImgURL) ?? asString(entry.image),
        } satisfies MetadataPersonRefView];
    });

  return cast.length ? cast : (tmdbTitle ? extractCast(tmdbTitle) : []);
}

export function buildProviderCrew(
  title: ProviderTitleRecord,
  extras: ProviderTitleBundle['extras'] | undefined,
  roles: string[],
  tmdbTitle?: TmdbTitleRecord | null,
): MetadataPersonRefView[] {
  const normalizedRoles = roles.map((role) => role.toLowerCase());
  if (title.provider === 'tvdb') {
    const source = buildProviderCast(title, extras, null);
    const seen = new Set<string>();
    const crew = source.filter((entry) => {
      const department = entry.department?.toLowerCase() ?? '';
      const role = entry.role?.toLowerCase() ?? '';
      const matches = normalizedRoles.some((candidate) => department.includes(candidate) || role.includes(candidate));
      if (!matches || seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    });

    if (crew.length) {
      return crew;
    }

    if (!tmdbTitle) {
      return [];
    }

    if (normalizedRoles.includes('director')) {
      return extractCrewByJob(tmdbTitle, 'Director');
    }

    return dedupePeople([...extractCreators(tmdbTitle), ...extractCrewByJob(tmdbTitle, 'Writer')]);
  }

  const seen = new Set<string>();
  const source = buildKitsuCrew(extras);
  return source.filter((entry) => {
    const department = entry.department?.toLowerCase() ?? '';
    const role = entry.role?.toLowerCase() ?? '';
    const matches = normalizedRoles.some((candidate) => department.includes(candidate) || role.includes(candidate));
    if (!matches || seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

export function buildProviderProduction(
  title: ProviderTitleRecord,
  extras?: ProviderTitleBundle['extras'],
  tmdbTitle?: TmdbTitleRecord | null,
): MetadataProductionInfoView | null {
  if (title.provider === 'tvdb') {
    const data = asRecord(asRecord(title.raw)?.data) ?? {};
    const companies = asArray(data.companies)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => buildProviderCompany(entry, 'tvdb'))
      .filter((entry): entry is MetadataCompanyView => entry !== null);
    const networks = [asRecord(data.originalNetwork), asRecord(data.latestNetwork)]
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => buildProviderCompany(entry, 'tvdb'))
      .filter((entry): entry is MetadataCompanyView => entry !== null);

    const production = {
      originalLanguage: asString(data.originalLanguage),
      originCountries: uniqueStrings([asString(data.country)]),
      spokenLanguages: [],
      productionCountries: companies.map((company) => company.originCountry).filter((entry): entry is string => Boolean(entry)),
      companies,
      networks,
    } satisfies MetadataProductionInfoView;

    if (production.companies.length || production.networks.length || production.originalLanguage || production.originCountries.length) {
      return production;
    }

    return tmdbTitle ? extractProduction(tmdbTitle) : production;
  }

  return buildKitsuProduction(extras);
}

function buildProviderCollection(_title: ProviderTitleRecord): MetadataCollectionView | null {
  return null;
}

function buildProviderSimilar(title: ProviderTitleRecord, extras?: ProviderTitleBundle['extras']): ProviderTitleRecord[] {
  if (title.provider !== 'kitsu') {
    return [];
  }
  return buildKitsuSimilar(title, extras);
}

export function buildProviderReviews(_title: ProviderTitleRecord, extras?: ProviderTitleBundle['extras']): MetadataReviewView[] {
  if (_title.provider === 'tvdb') {
    return [];
  }

  return buildKitsuReviews(extras);
}

function buildKitsuCast(extras?: ProviderTitleBundle['extras']): MetadataPersonRefView[] {
  const payload = asRecord(extras?.characters);
  const included = asArray(payload?.included)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const charactersById = new Map(
    included
      .filter((entry) => asString(entry.type) === 'characters')
      .map((entry) => [asString(entry.id) ?? '', entry] as const)
      .filter(([id]) => Boolean(id)),
  );
  const peopleById = new Map(
    included
      .filter((entry) => asString(entry.type) === 'people')
      .map((entry) => [asString(entry.id) ?? '', entry] as const)
      .filter(([id]) => Boolean(id)),
  );
  const voicesById = new Map(
    included
      .filter((entry) => asString(entry.type) === 'characterVoices')
      .map((entry) => [asString(entry.id) ?? '', entry] as const)
      .filter(([id]) => Boolean(id)),
  );

  return asArray(payload?.data)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .flatMap((entry) => {
      const entryId = asString(entry.id);
      const attrs = asRecord(entry.attributes);
      const relationships = asRecord(entry.relationships);
      const characterId = asString(asRecord(asRecord(relationships?.character)?.data)?.id);
      const character = characterId ? charactersById.get(characterId) ?? null : null;
      const voiceRefs = asArray(asRecord(relationships?.voices)?.data)
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value !== null);
      const voicePeople = voiceRefs
        .map((voiceRef) => asString(voiceRef.id))
        .filter((value): value is string => Boolean(value))
        .flatMap((voiceId) => {
          const voice = voicesById.get(voiceId);
          const personData = asRecord(asRecord(asRecord(voice?.relationships)?.person)?.data);
          const personId = asString(personData?.id);
          return personId ? [peopleById.get(personId)].filter((value): value is Record<string, unknown> => Boolean(value)) : [];
        });
      const person = voicePeople[0] ?? null;
      const personAttrs = asRecord(person?.attributes);
      const characterAttrs = asRecord(character?.attributes);
      const providerId = asString(person?.id) ?? entryId;
      const name = asString(personAttrs?.name) ?? asString(characterAttrs?.canonicalName) ?? asString(characterAttrs?.name);
      if (!providerId || !name) {
        return [];
      }

      const characterName = asString(characterAttrs?.canonicalName) ?? asString(characterAttrs?.name);
      return [{
        id: `person:kitsu:${providerId}`,
        provider: 'kitsu' as const,
        providerId,
        tmdbPersonId: null,
        name,
        role: characterName,
        department: asString(attrs?.role) ?? 'Cast',
        profileUrl: extractKitsuImageUrl(asRecord(personAttrs?.image)) ?? extractKitsuImageUrl(asRecord(characterAttrs?.image)),
      } satisfies MetadataPersonRefView];
    });
}

function buildKitsuCrew(extras?: ProviderTitleBundle['extras']): MetadataPersonRefView[] {
  const payload = asRecord(extras?.staff);
  const included = asArray(payload?.included)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const peopleById = new Map(
    included
      .filter((entry) => asString(entry.type) === 'people')
      .map((entry) => [asString(entry.id) ?? '', entry] as const)
      .filter(([id]) => Boolean(id)),
  );

  return asArray(payload?.data)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .flatMap((entry) => {
      const attrs = asRecord(entry.attributes);
      const personData = asRecord(asRecord(asRecord(entry.relationships)?.person)?.data);
      const personId = asString(personData?.id);
      const person = personId ? peopleById.get(personId) ?? null : null;
      const personAttrs = asRecord(person?.attributes);
      const providerId = personId ?? asString(entry.id);
      const name = asString(personAttrs?.name);
      if (!providerId || !name) {
        return [];
      }

      return [{
        id: `person:kitsu:${providerId}`,
        provider: 'kitsu' as const,
        providerId,
        tmdbPersonId: null,
        name,
        role: asString(attrs?.role),
        department: asString(attrs?.role),
        profileUrl: extractKitsuImageUrl(asRecord(personAttrs?.image)),
      } satisfies MetadataPersonRefView];
    });
}

function buildKitsuProduction(extras?: ProviderTitleBundle['extras']): MetadataProductionInfoView | null {
  const payload = asRecord(extras?.productions);
  const companies = asArray(payload?.data)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => {
      const attrs = asRecord(entry.attributes);
      const providerId = asString(entry.id);
      const name = asString(attrs?.producer) ?? asString(attrs?.name) ?? asString(attrs?.locale);
      if (!providerId || !name) {
        return null;
      }
      return {
        id: providerId,
        provider: 'kitsu' as const,
        providerId,
        name,
        logoUrl: null,
        originCountry: asString(attrs?.locale),
      } satisfies MetadataCompanyView;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (!companies.length) {
    return null;
  }

  return {
    originalLanguage: null,
    originCountries: uniqueStrings(companies.map((company) => company.originCountry)),
    spokenLanguages: [],
    productionCountries: uniqueStrings(companies.map((company) => company.originCountry)),
    companies,
    networks: [],
  };
}

function buildKitsuReviews(extras?: ProviderTitleBundle['extras']): MetadataReviewView[] {
  const payload = asRecord(extras?.reviews);
  return asArray(payload?.data)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .flatMap((entry) => {
      const attrs = asRecord(entry.attributes);
      const id = asString(entry.id);
      const content = asString(attrs?.content);
      if (!id || !content) {
        return [];
      }

      return [{
        id,
        author: asString(attrs?.source),
        username: asString(attrs?.source),
        content,
        createdAt: asString(attrs?.createdAt),
        updatedAt: asString(attrs?.updatedAt),
        url: null,
        rating: asInteger(attrs?.ratingTwenty) !== null ? Math.round((asInteger(attrs?.ratingTwenty) ?? 0) / 2) : null,
        avatarUrl: null,
      } satisfies MetadataReviewView];
    });
}

function buildKitsuSimilar(title: ProviderTitleRecord, extras?: ProviderTitleBundle['extras']): ProviderTitleRecord[] {
  const payload = asRecord(extras?.relationships);
  const included = asArray(payload?.included)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const animeById = new Map(
    included
      .filter((entry) => asString(entry.type) === 'anime')
      .map((entry) => [asString(entry.id) ?? '', entry] as const)
      .filter(([id]) => Boolean(id)),
  );

  return asArray(payload?.data)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .flatMap((entry) => {
      const destinationData = asRecord(asRecord(asRecord(entry.relationships)?.destination)?.data);
      const destinationId = asString(destinationData?.id);
      const destination = destinationId ? animeById.get(destinationId) ?? null : null;
      if (!destination) {
        return [];
      }
      const normalized = normalizeKitsuTitle({ data: destination, included: [] }, destinationId ?? title.providerId);
      if (normalized.providerId === title.providerId) {
        return [];
      }
      return [normalized];
    });
}

function buildProviderCompany(
  record: Record<string, unknown>,
  provider: SupportedProvider,
): MetadataCompanyView | null {
  const numericId = asInteger(record.id);
  const providerId = asString(record.id) ?? (numericId === null ? null : String(numericId));
  const name = asString(record.name);
  if (!providerId || !name) {
    return null;
  }

  return {
    id: numericId ?? providerId,
    provider,
    providerId,
    name,
    logoUrl: asString(record.image),
    originCountry: asString(record.country),
  };
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
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

function normalizeKitsuRating(value: unknown): number | null {
  const rating = asFloat(value);
  if (rating === null) {
    return null;
  }

  return Math.round((rating / 10) * 10) / 10;
}

function normalizeTvdbImageUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  const normalizedPath = value.startsWith('/') ? value : `/${value}`;
  return `https://artworks.thetvdb.com${normalizedPath}`;
}

function extractTvdbArtworkUrl(records: Record<string, unknown>[], preferredTypes: string[], language?: string | null): string | null {
  const normalizedTypes = preferredTypes.map((type) => type.toLowerCase());
  const preferredLanguage = normalizeLanguagePreference(language ?? null);
  const matches = records.filter((record) => {
    const type = asString(record.type)?.toLowerCase() ?? asString(record.typeName)?.toLowerCase() ?? '';
    return normalizedTypes.some((candidate) => type.includes(candidate));
  });

  const match = rankTvdbLocalizedRecords(matches, preferredLanguage)[0] ?? null;

  return normalizeTvdbImageUrl(asString(match?.image));
}

function extractTvdbTranslatedText(record: Record<string, unknown>, field: 'name' | 'overview', language: string): string | null {
  const translations = asRecord(record.translations);
  const key = field === 'name' ? 'nameTranslations' : 'overviewTranslations';
  const entries = asArray(translations?.[key])
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const primaryField = field === 'name' ? 'name' : 'overview';
  return selectTvdbTranslatedEntry(entries, primaryField, language)
    ?? selectTvdbTranslatedEntry(entries, primaryField, 'eng');
}

function selectTvdbTranslatedEntry(entries: Record<string, unknown>[], field: string, language: string): string | null {
  return entries
    .find((entry) => normalizeTvdbTranslationLanguage(asString(entry.language)) === language)
    ?.[field] as string | null ?? null;
}

function normalizeLanguagePreference(language: string | null): { alpha2: string; tvdb: string } {
  const alpha2 = (language?.split('-')[0]?.trim().toLowerCase() || 'en');
  const tvdb = TVDB_LANGUAGE_MAP[alpha2] ?? 'eng';
  return { alpha2, tvdb };
}

function normalizeTvdbTranslationLanguage(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 2) {
    return TVDB_LANGUAGE_MAP[normalized] ?? normalized;
  }
  return normalized;
}

function rankTvdbLocalizedRecords<T extends Record<string, unknown>>(
  records: T[],
  preferredLanguage: { alpha2: string; tvdb: string },
): T[] {
  return [...records].sort((left, right) => compareTvdbLanguageRank(left, preferredLanguage) - compareTvdbLanguageRank(right, preferredLanguage));
}

function compareTvdbLanguageRank(record: Record<string, unknown>, preferredLanguage: { alpha2: string; tvdb: string }): number {
  const language = normalizeTvdbTranslationLanguage(asString(record.language) ?? asString(record.iso6391) ?? asString(record.lang));
  if (language === preferredLanguage.tvdb || language === preferredLanguage.alpha2) {
    return 0;
  }
  if (language === 'eng' || language === 'en') {
    return 1;
  }
  if (language === null) {
    return 2;
  }
  return 3;
}

function rankTvdbTrailers(
  trailers: Record<string, unknown>[],
  preferredLanguage: { alpha2: string; tvdb: string },
): Record<string, unknown>[] {
  return [...trailers].sort((left, right) => compareTvdbLanguageRank(left, preferredLanguage) - compareTvdbLanguageRank(right, preferredLanguage));
}

function rankTmdbVideos(
  videos: MetadataVideoView[],
  tmdbTitle: TmdbTitleRecord,
  preferredLanguage: { alpha2: string; tvdb: string },
): MetadataVideoView[] {
  const byId = new Map(videos.map((video) => [video.id, video] as const));
  const rawVideos = asArray(asRecord(tmdbTitle.raw.videos)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .sort((left, right) => {
      const leftLang = asString(left.iso_639_1)?.toLowerCase() ?? null;
      const rightLang = asString(right.iso_639_1)?.toLowerCase() ?? null;
      return compareTmdbLanguageRank(leftLang, preferredLanguage.alpha2) - compareTmdbLanguageRank(rightLang, preferredLanguage.alpha2);
    });

  return rawVideos
    .map((entry) => byId.get(asString(entry.id) ?? ''))
    .filter((entry): entry is MetadataVideoView => entry !== undefined);
}

function compareTmdbLanguageRank(language: string | null, preferredAlpha2: string): number {
  if (language === preferredAlpha2) {
    return 0;
  }
  if (language === 'en') {
    return 1;
  }
  if (language === null) {
    return 2;
  }
  return 3;
}

function dedupePeople(people: MetadataPersonRefView[]): MetadataPersonRefView[] {
  const seen = new Set<string>();
  return people.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

const TVDB_LANGUAGE_MAP: Record<string, string> = {
  ar: 'ara',
  cs: 'ces',
  da: 'dan',
  de: 'deu',
  el: 'ell',
  en: 'eng',
  es: 'spa',
  fi: 'fin',
  fr: 'fra',
  he: 'heb',
  hi: 'hin',
  hu: 'hun',
  id: 'ind',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  nl: 'nld',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  ru: 'rus',
  sv: 'swe',
  th: 'tha',
  tr: 'tur',
  uk: 'ukr',
  vi: 'vie',
  zh: 'zho',
};

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
