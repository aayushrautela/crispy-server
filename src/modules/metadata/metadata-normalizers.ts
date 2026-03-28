import { appConfig } from '../../config/app-config.js';
import { buildEpisodeProviderId, buildSeasonProviderId, parentMediaTypeForIdentity, type MediaIdentity } from '../watch/media-key.js';
import type {
  MetadataCardView,
  MetadataCollectionView,
  MetadataCompanyView,
  MetadataEpisodePreview,
  MetadataEpisodeView,
  MetadataExternalIds,
  MetadataImages,
  MetadataParentMediaType,
  MetadataPersonRefView,
  MetadataProductionInfoView,
  ProviderEpisodeRecord,
  ProviderSeasonRecord,
  ProviderTitleRecord,
  MetadataReviewView,
  MetadataSeasonView,
  MetadataVideoView,
  MetadataView,
  TmdbEpisodeRecord,
  TmdbSeasonRecord,
  TmdbTitleRecord,
} from './tmdb.types.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function padded(value: number): string {
  return String(value).padStart(2, '0');
}

export function buildImageUrl(path: string | null, size: string): string | null {
  if (!path) {
    return null;
  }

  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  return `${appConfig.metadata.tmdb.imageBaseUrl.replace(/\/$/, '')}/${size}${path}`;
}

export function metadataMediaTypeFromTitle(title: TmdbTitleRecord): 'movie' | 'show' {
  return title.mediaType === 'movie' ? 'movie' : 'show';
}

export function deriveRuntimeMinutes(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): number | null {
  if (episode?.runtime) {
    return episode.runtime;
  }
  if (title?.runtime) {
    return title.runtime;
  }
  if (title?.episodeRunTime.length) {
    return title.episodeRunTime[0] ?? null;
  }
  return null;
}

export function extractReleaseDate(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): string | null {
  return episode?.airDate ?? title?.releaseDate ?? title?.firstAirDate ?? null;
}

export function extractReleaseYear(date: string | null): number | null {
  if (!date) {
    return null;
  }

  const year = Number(date.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

export function extractGenres(title: TmdbTitleRecord | null): string[] {
  const raw = title?.raw;
  if (!raw) {
    return [];
  }

  return asArray(raw.genres)
    .map((genre) => asString(asRecord(genre)?.name))
    .filter((value): value is string => value !== null);
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => value !== null)));
}

function preferNonEmpty<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

function normalizeAvatarUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith('/http://') || value.startsWith('/https://')) {
    return value.slice(1);
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return buildImageUrl(value, 'w185');
}

export function extractVideos(title: TmdbTitleRecord | null): MetadataVideoView[] {
  const results = asArray(asRecord(title?.raw.videos)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  return results
    .map((video) => {
      const id = asString(video.id);
      const key = asString(video.key);
      if (!id || !key) {
        return null;
      }

      const site = asString(video.site);
      return {
        id,
        key,
        name: asString(video.name),
        site,
        type: asString(video.type),
        official: asBoolean(video.official),
        publishedAt: asString(video.published_at),
        url: site === 'YouTube' ? `https://www.youtube.com/watch?v=${key}` : null,
        thumbnailUrl: site === 'YouTube' ? `https://img.youtube.com/vi/${key}/hqdefault.jpg` : null,
      } satisfies MetadataVideoView;
    })
    .filter((video): video is MetadataVideoView => video !== null);
}

function buildPersonRefView(record: Record<string, unknown>): MetadataPersonRefView | null {
  const tmdbPersonId = asNumber(record.id);
  const name = asString(record.name);
  if (!tmdbPersonId || !name) {
    return null;
  }

  return {
    id: `person:tmdb:${tmdbPersonId}`,
    provider: 'tmdb',
    providerId: String(tmdbPersonId),
    tmdbPersonId,
    name,
    role: preferNonEmpty(asString(record.character), asString(record.job)),
    department: asString(record.known_for_department) ?? asString(record.department),
    profileUrl: buildImageUrl(asString(record.profile_path), 'w185'),
  };
}

export function extractCast(title: TmdbTitleRecord | null): MetadataPersonRefView[] {
  return asArray(asRecord(title?.raw.credits)?.cast)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => buildPersonRefView(entry))
    .filter((entry): entry is MetadataPersonRefView => entry !== null)
    .slice(0, 20);
}

export function extractCrewByJob(title: TmdbTitleRecord | null, job: string): MetadataPersonRefView[] {
  const normalizedJob = job.trim().toLowerCase();
  const seen = new Set<number>();

  return asArray(asRecord(title?.raw.credits)?.crew)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => asString(entry.job)?.toLowerCase() === normalizedJob)
    .map((entry) => buildPersonRefView(entry))
    .filter((entry): entry is MetadataPersonRefView => {
      if (!entry || seen.has(entry.tmdbPersonId)) {
        return false;
      }
      seen.add(entry.tmdbPersonId);
      return true;
    });
}

export function extractCreators(title: TmdbTitleRecord | null): MetadataPersonRefView[] {
  return asArray(title?.raw.created_by)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => buildPersonRefView(entry))
    .filter((entry): entry is MetadataPersonRefView => entry !== null);
}

export function extractReviews(title: TmdbTitleRecord | null): MetadataReviewView[] {
  return asArray(asRecord(title?.raw.reviews)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((review) => {
      const id = asString(review.id);
      const content = asString(review.content);
      if (!id || !content) {
        return null;
      }

      const authorDetails = asRecord(review.author_details);
      return {
        id,
        author: asString(review.author),
        username: asString(authorDetails?.username),
        content,
        createdAt: asString(review.created_at),
        updatedAt: asString(review.updated_at),
        url: asString(review.url),
        rating: asNumber(authorDetails?.rating),
        avatarUrl: normalizeAvatarUrl(asString(authorDetails?.avatar_path)),
      } satisfies MetadataReviewView;
    })
    .filter((review): review is MetadataReviewView => review !== null)
    .slice(0, 10);
}

function buildCompanyView(record: Record<string, unknown>): MetadataCompanyView | null {
  const id = asNumber(record.id);
  const name = asString(record.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    logoUrl: buildImageUrl(asString(record.logo_path), 'w185'),
    originCountry: asString(record.origin_country),
  };
}

export function extractProduction(title: TmdbTitleRecord | null): MetadataProductionInfoView {
  const raw = title?.raw ?? {};
  return {
    originalLanguage: asString(raw.original_language),
    originCountries: uniqueStrings(asArray(raw.origin_country).map((entry) => asString(entry))),
    spokenLanguages: uniqueStrings(asArray(raw.spoken_languages).map((entry) => asString(asRecord(entry)?.english_name) ?? asString(asRecord(entry)?.name))),
    productionCountries: uniqueStrings(asArray(raw.production_countries).map((entry) => asString(asRecord(entry)?.name))),
    companies: asArray(raw.production_companies)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => buildCompanyView(entry))
      .filter((entry): entry is MetadataCompanyView => entry !== null),
    networks: asArray(raw.networks)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .map((entry) => buildCompanyView(entry))
      .filter((entry): entry is MetadataCompanyView => entry !== null),
  };
}

export function extractCollection(title: TmdbTitleRecord | null): MetadataCollectionView | null {
  const collection = asRecord(title?.raw.belongs_to_collection);
  if (!collection) {
    return null;
  }

  const id = asNumber(collection.id);
  const name = asString(collection.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    posterUrl: buildImageUrl(asString(collection.poster_path), 'w500'),
    backdropUrl: buildImageUrl(asString(collection.backdrop_path), 'w780'),
    parts: [],
  };
}

export function extractCollectionParts(collectionRaw: Record<string, unknown> | null): TmdbTitleRecord[] {
  return asArray(collectionRaw?.parts)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry): TmdbTitleRecord | null => {
      const tmdbId = asNumber(entry.id);
      if (!tmdbId) {
        return null;
      }

      return {
        mediaType: 'movie',
        tmdbId,
        name: asString(entry.title) ?? asString(entry.name),
        originalName: asString(entry.original_title) ?? asString(entry.original_name),
        overview: asString(entry.overview),
        releaseDate: asString(entry.release_date),
        firstAirDate: asString(entry.first_air_date),
        status: null,
        posterPath: asString(entry.poster_path),
        backdropPath: asString(entry.backdrop_path),
        runtime: asNumber(entry.runtime),
        episodeRunTime: [],
        numberOfSeasons: null,
        numberOfEpisodes: null,
        externalIds: {},
        raw: entry,
        fetchedAt: '',
        expiresAt: '',
      };
    })
    .filter((entry): entry is TmdbTitleRecord => entry !== null)
    .sort((left, right) => {
      const leftDate = left.releaseDate ?? '';
      const rightDate = right.releaseDate ?? '';
      if (leftDate !== rightDate) {
        return leftDate.localeCompare(rightDate);
      }
      return left.tmdbId - right.tmdbId;
    });
}

export function extractSimilarTitles(title: TmdbTitleRecord | null): TmdbTitleRecord[] {
  return asArray(asRecord(title?.raw.similar)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry): TmdbTitleRecord | null => {
      const tmdbId = asNumber(entry.id);
      if (!tmdbId || !title) {
        return null;
      }

      return {
        mediaType: title.mediaType,
        tmdbId,
        name: asString(entry.title) ?? asString(entry.name),
        originalName: asString(entry.original_title) ?? asString(entry.original_name),
        overview: asString(entry.overview),
        releaseDate: asString(entry.release_date),
        firstAirDate: asString(entry.first_air_date),
        status: null,
        posterPath: asString(entry.poster_path),
        backdropPath: asString(entry.backdrop_path),
        runtime: null,
        episodeRunTime: [],
        numberOfSeasons: null,
        numberOfEpisodes: null,
        externalIds: {},
        raw: entry,
        fetchedAt: title.fetchedAt,
        expiresAt: title.expiresAt,
      };
    })
    .filter((entry): entry is TmdbTitleRecord => entry !== null)
    .slice(0, 20);
}

function extractBestLogoPath(raw: Record<string, unknown>): string | null {
  const images = asRecord(raw.images);
  const logos = asArray(images?.logos)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const preferred = logos.find((logo) => asString(logo.iso_639_1) === 'en')
    ?? logos.find((logo) => asString(logo.iso_639_1) === null)
    ?? logos[0]
    ?? null;

  return preferred ? asString(preferred.file_path) : null;
}

export function extractRating(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): number | null {
  if (episode?.voteAverage !== null && episode?.voteAverage !== undefined) {
    return episode.voteAverage;
  }

  const raw = title?.raw;
  return raw ? asNumber(raw.vote_average) : null;
}

function extractMovieCertification(raw: Record<string, unknown>): string | null {
  const releaseDates = asArray(asRecord(raw.release_dates)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const preferredRegion = releaseDates.find((entry) => asString(entry.iso_3166_1) === 'US') ?? releaseDates[0] ?? null;
  if (!preferredRegion) {
    return null;
  }

  const certifications = asArray(preferredRegion.release_dates)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => asString(entry.certification))
    .filter((value): value is string => value !== null);

  return certifications[0] ?? null;
}

function extractShowCertification(raw: Record<string, unknown>): string | null {
  const ratings = asArray(asRecord(raw.content_ratings)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const preferredRegion = ratings.find((entry) => asString(entry.iso_3166_1) === 'US') ?? ratings[0] ?? null;
  return preferredRegion ? asString(preferredRegion.rating) : null;
}

export function extractCertification(title: TmdbTitleRecord | null): string | null {
  if (!title) {
    return null;
  }

  if (title.mediaType === 'movie') {
    return extractMovieCertification(title.raw);
  }

  return extractShowCertification(title.raw);
}

export function extractExternalIds(title: TmdbTitleRecord | null): MetadataExternalIds {
  const externalIds = title?.externalIds ?? {};
  const imdb = asString(externalIds.imdb_id);
  const tvdb = asNumber(externalIds.tvdb_id);

  return {
    tmdb: title?.tmdbId ?? null,
    imdb,
    tvdb,
    kitsu: null,
  };
}

export function buildMetadataImages(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): MetadataImages {
  return {
    posterUrl: buildImageUrl(title?.posterPath ?? null, 'w500'),
    backdropUrl: buildImageUrl(title?.backdropPath ?? null, 'w780'),
    stillUrl: buildImageUrl(episode?.stillPath ?? null, 'w500'),
    logoUrl: title ? buildImageUrl(extractBestLogoPath(title.raw), 'w500') : null,
  };
}

export function buildProviderMetadataImages(
  title: ProviderTitleRecord | null,
  episode: ProviderEpisodeRecord | null,
): MetadataImages {
  return {
    posterUrl: title?.posterUrl ?? null,
    backdropUrl: title?.backdropUrl ?? null,
    stillUrl: episode?.stillUrl ?? null,
    logoUrl: title?.logoUrl ?? null,
  };
}

export function buildEpisodePreview(
  title: TmdbTitleRecord,
  episode: TmdbEpisodeRecord,
  contentId: string,
): MetadataEpisodePreview {
  const images = buildMetadataImages(title, episode);

  return {
    id: contentId,
    mediaType: 'episode',
    provider: 'tmdb',
    providerId: buildEpisodeProviderId(String(episode.showTmdbId), episode.seasonNumber, episode.episodeNumber),
    parentMediaType: 'show',
    parentProvider: 'tmdb',
    parentProviderId: String(episode.showTmdbId),
    tmdbId: episode.tmdbId,
    showTmdbId: episode.showTmdbId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    absoluteEpisodeNumber: null,
    title: episode.name,
    summary: episode.overview,
    airDate: episode.airDate,
    runtimeMinutes: episode.runtime,
    rating: episode.voteAverage,
    images,
  };
}

export function buildProviderEpisodePreview(
  title: ProviderTitleRecord,
  episode: ProviderEpisodeRecord,
  contentId: string,
): MetadataEpisodePreview {
  const images = buildProviderMetadataImages(title, episode);

  return {
    id: contentId,
    mediaType: 'episode',
    provider: episode.provider,
    providerId: episode.providerId,
    parentMediaType: episode.parentMediaType,
    parentProvider: episode.parentProvider,
    parentProviderId: episode.parentProviderId,
    tmdbId: null,
    showTmdbId: null,
    seasonNumber: episode.seasonNumber ?? 1,
    episodeNumber: episode.episodeNumber ?? episode.absoluteEpisodeNumber ?? 1,
    absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
    title: episode.title,
    summary: episode.summary,
    airDate: episode.airDate,
    runtimeMinutes: episode.runtimeMinutes,
    rating: episode.rating,
    images,
  };
}

export function buildMetadataCardView(params: {
  id: string;
  identity: MediaIdentity;
  title: TmdbTitleRecord | null;
  currentEpisode?: TmdbEpisodeRecord | null;
  titleOverride?: string | null;
  subtitleOverride?: string | null;
  summaryOverride?: string | null;
  overviewOverride?: string | null;
  posterUrlOverride?: string | null;
  backdropUrlOverride?: string | null;
}): MetadataCardView {
  const { identity, title } = params;
  const currentEpisode = params.currentEpisode ?? null;
  const releaseDate = extractReleaseDate(title, currentEpisode);
  const images = buildMetadataImages(title, currentEpisode);
  const resolvedMediaType = identity.mediaType === 'show'
    || identity.mediaType === 'episode'
    || identity.mediaType === 'anime'
    ? identity.mediaType
    : 'movie';
  const titleName = params.titleOverride ?? (
    resolvedMediaType === 'episode'
      ? title?.name ?? title?.originalName ?? currentEpisode?.name ?? null
      : currentEpisode?.name ?? title?.name ?? title?.originalName ?? null
  );
  const subtitle = params.subtitleOverride ?? (
    resolvedMediaType === 'episode'
      ? currentEpisode?.name ?? (
        identity.seasonNumber !== null && identity.episodeNumber !== null
          ? `S${padded(identity.seasonNumber)} E${padded(identity.episodeNumber)}`
          : null
      )
      : title?.status ?? null
  );
  const posterUrl = params.posterUrlOverride ?? images.posterUrl;
  const backdropUrl = params.backdropUrlOverride ?? images.backdropUrl;

  return {
    id: params.id,
    mediaKey: identity.mediaKey,
    mediaType: resolvedMediaType,
    kind: resolvedMediaType === 'episode' ? 'episode' : 'title',
    provider: identity.provider ?? 'tmdb',
    providerId: identity.providerId ?? String(identity.tmdbId ?? identity.showTmdbId ?? params.id),
    parentMediaType: identity.mediaType === 'episode' || identity.mediaType === 'season'
      ? (parentMediaTypeForIdentity(identity) === 'anime' ? 'anime' : 'show')
      : null,
    parentProvider: identity.parentProvider ?? null,
    parentProviderId: identity.parentProviderId ?? null,
    tmdbId: identity.tmdbId,
    showTmdbId: identity.showTmdbId,
    seasonNumber: identity.seasonNumber,
    episodeNumber: identity.episodeNumber,
    absoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
    title: titleName,
    subtitle,
    summary: params.summaryOverride ?? currentEpisode?.overview ?? title?.overview ?? null,
    overview: params.overviewOverride ?? currentEpisode?.overview ?? title?.overview ?? null,
    artwork: {
      posterUrl,
      backdropUrl,
      stillUrl: images.stillUrl,
    },
    images: {
      ...images,
      posterUrl,
      backdropUrl,
    },
    releaseDate,
    releaseYear: extractReleaseYear(releaseDate),
    runtimeMinutes: deriveRuntimeMinutes(title, currentEpisode),
    rating: extractRating(title, currentEpisode),
    status: title?.status ?? null,
  };
}

export function buildMetadataView(params: {
  id: string;
  identity: MediaIdentity;
  title: TmdbTitleRecord | null;
  currentEpisode?: TmdbEpisodeRecord | null;
  nextEpisode?: TmdbEpisodeRecord | null;
  nextEpisodeId?: string | null;
}): MetadataView {
  const card = buildMetadataCardView(params);
  const { identity, title } = params;
  const currentEpisode = params.currentEpisode ?? null;

  return {
    ...card,
    runtimeMinutes: deriveRuntimeMinutes(title, currentEpisode),
    certification: extractCertification(title),
    genres: extractGenres(title),
    externalIds: extractExternalIds(title),
    seasonCount: title?.numberOfSeasons ?? null,
    episodeCount: title?.numberOfEpisodes ?? null,
    nextEpisode: title && params.nextEpisode && params.nextEpisodeId
      ? buildEpisodePreview(title, params.nextEpisode, params.nextEpisodeId)
      : null,
  };
}

function resolveProviderParentMediaType(identity: MediaIdentity): MetadataParentMediaType | null {
  if (identity.mediaType !== 'episode' && identity.mediaType !== 'season') {
    return null;
  }

  return parentMediaTypeForIdentity(identity) === 'anime' ? 'anime' : 'show';
}

function buildProviderEpisodeSubtitle(episode: ProviderEpisodeRecord | null): string | null {
  if (!episode) {
    return null;
  }

  if (episode.title?.trim()) {
    return episode.title;
  }

  if (episode.seasonNumber !== null && episode.episodeNumber !== null) {
    return `S${padded(episode.seasonNumber)} E${padded(episode.episodeNumber)}`;
  }

  if (episode.absoluteEpisodeNumber !== null) {
    return `Episode ${episode.absoluteEpisodeNumber}`;
  }

  return null;
}

export function buildProviderMetadataCardView(params: {
  id: string;
  identity: MediaIdentity;
  title: ProviderTitleRecord;
  currentEpisode?: ProviderEpisodeRecord | null;
}): MetadataCardView {
  const { identity, title } = params;
  const currentEpisode = params.currentEpisode ?? null;
  const images = buildProviderMetadataImages(title, currentEpisode);
  const releaseDate = currentEpisode?.airDate ?? title.releaseDate;
  const resolvedMediaType = identity.mediaType === 'episode'
    ? 'episode'
    : identity.mediaType === 'anime'
      ? 'anime'
      : identity.mediaType === 'show'
        ? 'show'
        : 'movie';

  return {
    id: params.id,
    mediaKey: identity.mediaKey,
    mediaType: resolvedMediaType,
    kind: resolvedMediaType === 'episode' ? 'episode' : 'title',
    provider: currentEpisode?.provider ?? title.provider,
    providerId: currentEpisode?.providerId ?? title.providerId,
    parentMediaType: resolveProviderParentMediaType(identity),
    parentProvider: identity.parentProvider ?? currentEpisode?.parentProvider ?? null,
    parentProviderId: identity.parentProviderId ?? currentEpisode?.parentProviderId ?? null,
    tmdbId: identity.tmdbId,
    showTmdbId: identity.showTmdbId,
    seasonNumber: identity.seasonNumber,
    episodeNumber: identity.episodeNumber,
    absoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? currentEpisode?.absoluteEpisodeNumber ?? null,
    title: resolvedMediaType === 'episode'
      ? title.title
      : currentEpisode?.title ?? title.title,
    subtitle: resolvedMediaType === 'episode'
      ? buildProviderEpisodeSubtitle(currentEpisode)
      : title.status,
    summary: currentEpisode?.summary ?? title.summary,
    overview: currentEpisode?.summary ?? title.overview,
    artwork: {
      posterUrl: images.posterUrl,
      backdropUrl: images.backdropUrl,
      stillUrl: images.stillUrl,
    },
    images,
    releaseDate,
    releaseYear: extractReleaseYear(releaseDate),
    runtimeMinutes: currentEpisode?.runtimeMinutes ?? title.runtimeMinutes,
    rating: currentEpisode?.rating ?? title.rating,
    status: title.status,
  };
}

export function buildProviderMetadataView(params: {
  id: string;
  identity: MediaIdentity;
  title: ProviderTitleRecord;
  currentEpisode?: ProviderEpisodeRecord | null;
  nextEpisode?: ProviderEpisodeRecord | null;
  nextEpisodeId?: string | null;
}): MetadataView {
  const card = buildProviderMetadataCardView(params);

  return {
    ...card,
    runtimeMinutes: params.currentEpisode?.runtimeMinutes ?? params.title.runtimeMinutes,
    certification: params.title.certification,
    genres: params.title.genres,
    externalIds: params.title.externalIds,
    seasonCount: params.title.seasonCount,
    episodeCount: params.title.episodeCount,
    nextEpisode: params.nextEpisode && params.nextEpisodeId
      ? buildProviderEpisodePreview(params.title, params.nextEpisode, params.nextEpisodeId)
      : null,
  };
}

export function buildSeasonViewFromTitleRaw(
  title: TmdbTitleRecord,
  showId: string,
  seasonIds: Map<number, string>,
): MetadataSeasonView[] {
  const seasons = asArray(title.raw.seasons)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((season) => {
      const seasonNumber = asNumber(season.season_number);
      if (seasonNumber === null || seasonNumber < 0) {
        return null;
      }

      const seasonId = seasonIds.get(seasonNumber);
      if (!seasonId) {
        return null;
      }

      return {
        id: seasonId,
        showId,
        provider: 'tmdb',
        providerId: buildSeasonProviderId(String(title.tmdbId), seasonNumber),
        parentMediaType: 'show',
        parentProvider: 'tmdb',
        parentProviderId: String(title.tmdbId),
        showTmdbId: title.tmdbId,
        seasonNumber,
        title: asString(season.name),
        summary: asString(season.overview),
        airDate: asString(season.air_date),
        episodeCount: asNumber(season.episode_count),
        images: {
          posterUrl: buildImageUrl(asString(season.poster_path), 'w500'),
        },
      } satisfies MetadataSeasonView;
    })
    .filter((season): season is NonNullable<typeof season> => season !== null)
    .sort((left, right) => left.seasonNumber - right.seasonNumber);

  return seasons;
}

export function buildSeasonViewFromRecord(
  showTmdbId: number,
  season: TmdbSeasonRecord,
  seasonId: string,
  showId: string,
): MetadataSeasonView {
  return {
    id: seasonId,
    showId,
    provider: 'tmdb',
    providerId: buildSeasonProviderId(String(showTmdbId), season.seasonNumber),
    parentMediaType: 'show',
    parentProvider: 'tmdb',
    parentProviderId: String(showTmdbId),
    showTmdbId,
    seasonNumber: season.seasonNumber,
    title: season.name,
    summary: season.overview,
    airDate: season.airDate,
    episodeCount: season.episodeCount,
    images: {
      posterUrl: buildImageUrl(season.posterPath, 'w500'),
    },
  };
}

export function buildProviderSeasonViewFromRecord(
  season: ProviderSeasonRecord,
  seasonId: string,
  showId: string,
  showTmdbId: number | null = null,
): MetadataSeasonView {
  return {
    id: seasonId,
    showId,
    provider: season.provider,
    providerId: season.providerId,
    parentMediaType: season.parentMediaType,
    parentProvider: season.parentProvider,
    parentProviderId: season.parentProviderId,
    showTmdbId,
    seasonNumber: season.seasonNumber,
    title: season.title,
    summary: season.summary,
    airDate: season.airDate,
    episodeCount: season.episodeCount,
    images: {
      posterUrl: season.posterUrl,
    },
  };
}

export function buildEpisodeView(
  title: TmdbTitleRecord,
  episode: TmdbEpisodeRecord,
  contentId: string,
  showId: string,
): MetadataEpisodeView {
  return {
    ...buildEpisodePreview(title, episode, contentId),
    showId,
    showTitle: title.name ?? title.originalName,
    showExternalIds: extractExternalIds(title),
  };
}

export function buildProviderEpisodeView(
  title: ProviderTitleRecord,
  episode: ProviderEpisodeRecord,
  contentId: string,
  showId: string,
): MetadataEpisodeView {
  return {
    ...buildProviderEpisodePreview(title, episode, contentId),
    showId,
    showTitle: title.title,
    showExternalIds: title.externalIds,
  };
}
