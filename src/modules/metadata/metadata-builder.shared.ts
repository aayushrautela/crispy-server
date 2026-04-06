import { appConfig } from '../../config/app-config.js';
import type { SupportedProvider } from '../identity/media-key.js';
import type {
  MetadataCollectionView,
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
  ProviderEpisodeRecord,
  ProviderSeasonRecord,
  ProviderTitleRecord,
} from './metadata-card.types.js';
import type {
  TmdbEpisodeRecord,
  TmdbSeasonRecord,
  TmdbTitleRecord,
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
  const seen = new Set<string>();

  return asArray(asRecord(title?.raw.credits)?.crew)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => asString(entry.job)?.toLowerCase() === normalizedJob)
    .map((entry) => buildPersonRefView(entry))
    .filter((entry): entry is MetadataPersonRefView => {
      if (!entry) {
        return false;
      }
      const key = `${entry.provider}:${entry.providerId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
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
    provider: 'tmdb',
    providerId: String(id),
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
    provider: 'tmdb',
    providerId: String(id),
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
