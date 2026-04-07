import {
  buildAbsoluteEpisodeProviderId,
  buildEpisodeProviderId,
  buildSeasonProviderId,
} from '../../identity/media-key.js';
import type { MetadataExternalIds, ProviderEpisodeRecord, ProviderSeasonRecord, ProviderTitleRecord } from '../metadata-card.types.js';
import type { ProviderTitleBundle } from './provider-bundle.types.js';

export function buildTvdbBundleFromPayloads(
  seriesPayload: Record<string, unknown>,
  episodesPayload: Record<string, unknown>,
  seriesId: string,
  language?: string | null,
): ProviderTitleBundle {
  const series = asRecord(seriesPayload.data);
  if (!series) {
    throw new Error('TVDB series payload missing data.');
  }

  const title = normalizeTvdbTitle(seriesPayload, seriesId, language ?? null);
  const normalized = normalizeTvdbSeasons(
    asArray(series.seasons)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null),
    dedupeProviderEpisodes([
      ...extractTvdbEpisodes(seriesPayload, seriesId, language ?? null),
      ...extractTvdbEpisodes(episodesPayload, seriesId, language ?? null),
    ]),
  );
  const episodes = normalized.episodes;
  const seasons = deriveTvdbSeasons(normalized.seasons, series, seriesId, episodes, title.episodeCount);

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

export function buildKitsuBundleFromPayloads(
  payloads: {
    animePayload: Record<string, unknown>;
    episodesPayload: Record<string, unknown>;
    charactersPayload: Record<string, unknown>;
    staffPayload: Record<string, unknown>;
    relationshipsPayload: Record<string, unknown>;
    productionsPayload: Record<string, unknown>;
    reviewsPayload: Record<string, unknown>;
  },
  animeId: string,
): ProviderTitleBundle {
  const anime = asRecord(payloads.animePayload.data);
  if (!anime) {
    throw new Error('Kitsu anime payload missing data.');
  }

  const included = asArray(payloads.animePayload.included);
  const title = normalizeKitsuTitle(payloads.animePayload, animeId);
  const episodes = dedupeProviderEpisodes([
    ...extractKitsuEpisodesFromIncluded(included, animeId),
    ...extractKitsuEpisodesFromPayload(payloads.episodesPayload, animeId),
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
      characters: payloads.charactersPayload,
      staff: payloads.staffPayload,
      relationships: payloads.relationshipsPayload,
      productions: payloads.productionsPayload,
      reviews: payloads.reviewsPayload,
    },
  };
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

export function extractTvdbEpisodes(payload: Record<string, unknown>, seriesId: string, language?: string | null): ProviderEpisodeRecord[] {
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

export function extractTvdbEpisodeItems(payload: Record<string, unknown>): Record<string, unknown>[] {
  const data = asRecord(payload.data);
  const direct = asArray(payload.data)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  if (direct.length) {
    return direct;
  }

  return asArray(data?.episodes)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

export function extractKitsuEpisodesFromIncluded(included: unknown[], animeId: string): ProviderEpisodeRecord[] {
  return included
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => asString(entry.type) === 'episodes')
    .map((entry) => normalizeKitsuEpisode(entry, animeId))
    .filter((entry): entry is ProviderEpisodeRecord => entry !== null);
}

export function extractKitsuEpisodesFromPayload(payload: Record<string, unknown>, animeId: string): ProviderEpisodeRecord[] {
  return asArray(payload.data)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => normalizeKitsuEpisode(entry, animeId))
    .filter((entry): entry is ProviderEpisodeRecord => entry !== null);
}

export function dedupeProviderEpisodes(episodes: ProviderEpisodeRecord[]): ProviderEpisodeRecord[] {
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

function deriveTvdbSeasons(
  normalizedSeasons: Record<string, unknown>[],
  series: Record<string, unknown>,
  seriesId: string,
  episodes: ProviderEpisodeRecord[],
  episodeCount: number | null,
): ProviderSeasonRecord[] {
  const seasonMap = new Map<number, ProviderSeasonRecord>();
  for (const season of normalizedSeasons) {
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

function normalizeTvdbSeasons(
  seasons: Record<string, unknown>[],
  episodes: ProviderEpisodeRecord[],
): {
  seasons: Record<string, unknown>[];
  episodes: ProviderEpisodeRecord[];
} {
  const hasYearSeasons = seasons.some((season) => {
    const seasonNumber = asInteger(season.number) ?? asInteger(season.seasonNumber);
    return seasonNumber !== null && seasonNumber > 1900;
  });

  if (!hasYearSeasons) {
    return { seasons, episodes };
  }

  const sortedSeasons = [...seasons].sort((left, right) => {
    const leftNumber = asInteger(left.number) ?? asInteger(left.seasonNumber) ?? 0;
    const rightNumber = asInteger(right.number) ?? asInteger(right.seasonNumber) ?? 0;
    return leftNumber - rightNumber;
  });

  const seasonMap = new Map<number, number>();
  const normalizedSeasons: Record<string, unknown>[] = [];
  const specials = sortedSeasons.find((season) => {
    const seasonNumber = asInteger(season.number) ?? asInteger(season.seasonNumber);
    return seasonNumber === 0;
  });
  if (specials) {
    normalizedSeasons.push(specials);
  }

  let seasonCounter = 1;
  for (const season of sortedSeasons) {
    const seasonNumber = asInteger(season.number) ?? asInteger(season.seasonNumber);
    if (seasonNumber === null || seasonNumber === 0) {
      continue;
    }

    seasonMap.set(seasonNumber, seasonCounter);
    normalizedSeasons.push({
      ...season,
      number: seasonCounter,
      name: asString(season.name) ?? `Season ${seasonCounter} (${seasonNumber})`,
    });
    seasonCounter += 1;
  }

  const normalizedEpisodes = episodes.map((episode) => {
    if ((episode.seasonNumber ?? 0) === 0) {
      return episode;
    }

    const newSeasonNumber = episode.seasonNumber === null ? null : seasonMap.get(episode.seasonNumber) ?? null;
    if (newSeasonNumber === null) {
      return episode;
    }

    return {
      ...episode,
      seasonNumber: newSeasonNumber,
      raw: {
        ...asRecord(episode.raw),
        originalSeasonNumber: episode.seasonNumber,
      },
    } satisfies ProviderEpisodeRecord;
  });

  return {
    seasons: normalizedSeasons,
    episodes: normalizedEpisodes,
  };
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

function normalizeTvdbEpisode(record: Record<string, unknown>, seriesId: string, language?: string | null): ProviderEpisodeRecord | null {
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
