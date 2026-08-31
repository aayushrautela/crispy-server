import { appConfig } from '../../config/app-config.js';
import type { DbClient } from '../../lib/db.js';
import type { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import type { SupportedProvider } from '../identity/media-key.js';
import type {
  MetadataCompanyView,
  MetadataPersonRefView,
  MetadataProductionInfoView,
  MetadataReviewView,
  MetadataVideoView,
} from './metadata-detail.types.js';
import type {
  MetadataExternalIds,
  MetadataImages,
  MetadataParentMediaType,
  ResponsiveImageSet,
} from './metadata-card.types.js';
import type {
  TmdbEpisodeRecord,
  TmdbSeasonRecord,
  TmdbTitleRecord,
  TmdbTitleType,
} from './providers/tmdb.types.js';

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

export function padded(value: number): string {
  return String(value).padStart(2, '0');
}

const tmdbUrlPattern = /^https?:\/\/image\.tmdb\.org\/t\/p\/[^/]+\/(.+)$/;

export function buildImageUrl(path: string | null, size: string): string | null {
  if (!path) {
    return null;
  }

  const baseUrl = appConfig.metadata.tmdb.imageBaseUrl.replace(/\/$/, '');

  if (path.startsWith('http://') || path.startsWith('https://')) {
    const match = path.match(tmdbUrlPattern);
    if (match) {
      return `${baseUrl}/${size}/${match[1]}`;
    }
    return path;
  }

  return `${baseUrl}/${size}${path}`;
}

export function buildResponsiveImageSet(
  path: string | null,
  sizes: { small: string; medium: string; large: string },
): ResponsiveImageSet {
  return {
    small: buildImageUrl(path, sizes.small),
    medium: buildImageUrl(path, sizes.medium),
    large: buildImageUrl(path, sizes.large),
  };
}

export function emptyResponsiveImageSet(): ResponsiveImageSet {
  return {
    small: null,
    medium: null,
    large: null,
  };
}

export function extractBackdropPaths(raw: Record<string, unknown> | null, limit = 5): string[] {
  const images = raw ? asRecord(raw.images) : null;
  const backdrops = images ? asArray(images.backdrops) : [];

  const entries = backdrops
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null && entry.iso_639_1 === null)
    .map((entry) => ({
      filePath: asString(entry.file_path),
      voteAverage: typeof entry.vote_average === 'number' && Number.isFinite(entry.vote_average)
        ? entry.vote_average
        : null,
      voteCount: typeof entry.vote_count === 'number' && Number.isFinite(entry.vote_count)
        ? entry.vote_count
        : 0,
    }))
    .filter((entry): entry is { filePath: string; voteAverage: number | null; voteCount: number } => entry.filePath !== null);

  const globalMean = computeGlobalMean(entries);
  const minVotes = 5;

  return entries
    .map((entry) => ({
      filePath: entry.filePath,
      score: entry.voteAverage !== null
        ? weightedRating(entry.voteAverage, entry.voteCount, globalMean, minVotes)
        : 0,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.filePath);
}

function computeGlobalMean(entries: Array<{ voteAverage: number | null; voteCount: number }>): number {
  const rated = entries.filter((e): e is { voteAverage: number; voteCount: number } => e.voteAverage !== null);
  if (rated.length === 0) {
    return 0;
  }
  const totalVotes = rated.reduce((sum, e) => sum + e.voteCount, 0);
  if (totalVotes === 0) {
    return rated.reduce((sum, e) => sum + e.voteAverage, 0) / rated.length;
  }
  return rated.reduce((sum, e) => sum + e.voteAverage * e.voteCount, 0) / totalVotes;
}

function weightedRating(voteAverage: number, voteCount: number, globalMean: number, minVotes: number): number {
  return (voteCount / (voteCount + minVotes)) * voteAverage + (minVotes / (voteCount + minVotes)) * globalMean;
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

  const fromRaw = asArray(raw.genres)
    .map((genre) => asString(asRecord(genre)?.name))
    .filter((value): value is string => value !== null);

  if (fromRaw.length > 0) {
    return fromRaw;
  }

  // Fallback for summary-cached titles: raw may be {}, but genre_ids column is populated.
  if (title && Array.isArray(title.genreIds) && title.genreIds.length > 0) {
    return title.genreIds
      .map((id) => TMDB_GENRE_NAMES[id])
      .filter((name): name is string => name !== undefined);
  }

  return [];
}

const TMDB_GENRE_NAMES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
};

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

export function extractPrimaryTrailer(title: TmdbTitleRecord | null, preferredLanguage?: string | null): MetadataVideoView | null {
  if (!title) {
    return null;
  }

  const results = asArray(asRecord(title.raw.videos)?.results)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const originalLanguage = asString(asRecord(title.raw)?.original_language);
  const languageTiers = uniqueStrings([
    preferredLanguage ?? null,
    'en',
    originalLanguage,
    null,
  ]);

  for (const language of languageTiers) {
    const trailer = pickPrimaryTrailerFromVideos(results, language);
    if (trailer) {
      return trailer;
    }
  }

  return null;
}

function pickPrimaryTrailerFromVideos(videos: Record<string, unknown>[], language: string | null): MetadataVideoView | null {
  let best: MetadataVideoView | null = null;
  let bestScore = -1;

  for (const video of videos) {
    if (language !== null && asString(video.iso_639_1) !== language) {
      continue;
    }

    const id = asString(video.id);
    const key = asString(video.key);
    const site = asString(video.site);
    if (!id || !key || site !== 'YouTube') {
      continue;
    }

    const type = asString(video.type);
    const score = type === 'Trailer' && asBoolean(video.official) ? 10000
      : type === 'Trailer' ? 5000
      : 1000;

    if (score > bestScore) {
      bestScore = score;
      best = {
        id,
        key,
        name: asString(video.name),
        site,
        type,
        official: asBoolean(video.official),
        publishedAt: asString(video.published_at),
        url: `https://www.youtube.com/watch?v=${key}`,
        thumbnailUrl: `https://img.youtube.com/vi/${key}/hqdefault.jpg`,
      };
    }
  }

  return best;
}

export function extractExtraVideos(title: TmdbTitleRecord | null): MetadataVideoView[] {
  return extractVideos(title).filter((video) =>
    video.url && (video.type === 'Behind the Scenes' || video.type === 'Bloopers'),
  );
}

async function buildPersonRefView(client: DbClient, contentIdentityService: ContentIdentityService, record: Record<string, unknown>): Promise<MetadataPersonRefView | null> {
  const tmdbPersonId = asNumber(record.id);
  const name = asString(record.name);
  if (!tmdbPersonId || !name) {
    return null;
  }

  const contentId = await contentIdentityService.ensurePersonContentId(client, {
    provider: 'tmdb',
    providerId: tmdbPersonId,
    metadata: { name },
  });

  return {
    personId: encodePublicItemId(contentId),
    name,
    role: preferNonEmpty(asString(record.character), asString(record.job)),
    department: asString(record.known_for_department) ?? asString(record.department),
    profileUrl: buildImageUrl(asString(record.profile_path), 'w185'),
  };
}

export async function extractCast(client: DbClient, contentIdentityService: ContentIdentityService, title: TmdbTitleRecord | null): Promise<MetadataPersonRefView[]> {
  const people = await Promise.all(asArray(asRecord(title?.raw.credits)?.cast)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => buildPersonRefView(client, contentIdentityService, entry)));

  return people
    .filter((entry): entry is MetadataPersonRefView => entry !== null)
    .slice(0, 20);
}

export async function extractCrewByJob(client: DbClient, contentIdentityService: ContentIdentityService, title: TmdbTitleRecord | null, job: string): Promise<MetadataPersonRefView[]> {
  const normalizedJob = job.trim().toLowerCase();
  const seen = new Set<string>();
  const people = await Promise.all(asArray(asRecord(title?.raw.credits)?.crew)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => asString(entry.job)?.toLowerCase() === normalizedJob)
    .map((entry) => buildPersonRefView(client, contentIdentityService, entry)));

  return people.filter((entry): entry is MetadataPersonRefView => {
    if (!entry) {
      return false;
    }
    if (seen.has(entry.personId)) {
      return false;
    }
    seen.add(entry.personId);
    return true;
  });
}

export async function extractCreators(client: DbClient, contentIdentityService: ContentIdentityService, title: TmdbTitleRecord | null): Promise<MetadataPersonRefView[]> {
  const people = await Promise.all(asArray(title?.raw.created_by)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => buildPersonRefView(client, contentIdentityService, {
      ...entry,
      job: 'Creator',
      known_for_department: asString(entry.known_for_department) ?? 'Creator',
    })));

  return people
    .filter((entry): entry is MetadataPersonRefView => entry !== null)
    .slice(0, 1);
}

function buildCompanyView(record: Record<string, unknown>): MetadataCompanyView | null {
  const id = asNumber(record.id);
  const name = asString(record.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    provider: 'tmdb',
    providerId: String(id),
    name,
    logo: buildResponsiveImageSet(asString(record.logo_path), {
      small: 'w185',
      medium: 'w300',
      large: 'w500',
    }),
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

export function extractCollection(title: TmdbTitleRecord | null): {
  id: number;
  provider: string;
  providerId: string;
  name: string;
  artwork: ResponsiveImageSet;
  parts: TmdbTitleRecord[];
} | null {
  const collection = asRecord(title?.raw.belongs_to_collection);
  if (!collection) {
    return null;
  }

  const id = asNumber(collection.id);
  const name = asString(collection.name);
  if (!id || !name) {
    return null;
  }

  const posterPath = asString(collection.poster_path);
  const backdropPath = asString(collection.backdrop_path);

  return {
    id,
    provider: 'tmdb',
    providerId: String(id),
    name,
    artwork: buildMergedArtwork(backdropPath, posterPath),
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
        language: 'en',
        name: asString(entry.title) ?? asString(entry.name),
        originalName: asString(entry.original_title) ?? asString(entry.original_name),
        overview: asString(entry.overview),
        tagline: null,
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
        hydrationLevel: 'summary',
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

function extractBestLogoPath(raw: Record<string, unknown>, preferredLanguage?: string | null): string | null {
  const images = asRecord(raw.images);
  const logos = asArray(images?.logos)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const preferred = preferredLanguage
    ? (logos.find((logo) => asString(logo.iso_639_1) === preferredLanguage)
      ?? logos.find((logo) => asString(logo.iso_639_1) === 'en')
      ?? logos[0])
    : (logos.find((logo) => asString(logo.iso_639_1) === 'en')
      ?? logos[0]);

  return preferred ? asString(preferred.file_path) : null;
}

export function extractRating(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null): number | null {
  if (episode?.voteAverage !== null && episode?.voteAverage !== undefined) {
    return episode.voteAverage;
  }

  if (title?.voteAverage !== null && title?.voteAverage !== undefined) {
    return title.voteAverage;
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
  };
}

export function buildMetadataImages(title: TmdbTitleRecord | null, episode: TmdbEpisodeRecord | null, preferredLanguage?: string | null, seasonPosterPath?: string | null): MetadataImages {
  const posterPath = seasonPosterPath ?? title?.posterPath ?? null;
  const backdropPath = episode?.stillPath ?? title?.backdropPath ?? null;
  return {
    artwork: buildMergedArtwork(backdropPath, posterPath),
    still: buildResponsiveImageSet(episode?.stillPath ?? null, {
      small: 'w300',
      medium: 'h632',
      large: 'original',
    }),
    logo: buildResponsiveImageSet(extractBestLogoPath(title?.raw ?? {}, preferredLanguage), {
      small: 'w185',
      medium: 'w500',
      large: 'original',
    }),
  };
}

function buildMergedArtwork(backdropPath: string | null, posterPath: string | null): ResponsiveImageSet {
  const backdrop = buildResponsiveImageSet(backdropPath, {
    small: 'w780',
    medium: 'w1280',
    large: 'original',
  });
  const poster = buildResponsiveImageSet(posterPath, {
    small: 'w342',
    medium: 'w500',
    large: 'w780',
  });
  return {
    small: backdrop.small ?? poster.small,
    medium: backdrop.medium ?? poster.medium,
    large: backdrop.large ?? poster.large,
  };
}
