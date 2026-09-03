import { appConfig } from '../../../config/app-config.js';
import type { DbClient } from '../../../lib/db.js';
import { HttpError } from '../../../lib/errors.js';
import { buildTmdbIncludeImageLanguage, normalizeMetadataLanguage, toTmdbLanguageQuery } from '../metadata-language.js';
import type { TmdbEpisodeRecord, TmdbImageRecord, TmdbPersonRecord, TmdbTitleRecord, TmdbTitleType, TmdbTranslationEntry } from './tmdb.types.js';
import { TmdbClient } from './tmdb.client.js';
import { TmdbRepository } from './tmdb.repo.js';

type DetailPayload = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const DEADLOCK_RETRY_ATTEMPTS = 3;
const DEADLOCK_RETRY_BASE_DELAY_MS = 50;

interface PgErrorLike {
  code?: string;
}

function isDeadlockError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as PgErrorLike).code === '40P01'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A 40P01 deadlock aborts the whole transaction. The TMDB fetch happens before
// the transaction, so retrying just re-runs the writes after a short backoff.
async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      attempt += 1;
      if (!isDeadlockError(error) || attempt >= DEADLOCK_RETRY_ATTEMPTS) {
        throw error;
      }
      const delay = DEADLOCK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 50;
      await sleep(delay);
    }
  }
}

/**
 * The only component allowed to talk to the TMDB API and to write metadata
 * tables. One HTTP request per entity fans out into typed table writes inside
 * a single transaction; nothing downstream ever parses provider JSON.
 */
export class TmdbIngestService {
  constructor(
    private readonly tmdbClient = new TmdbClient(),
    private readonly repository = new TmdbRepository(),
  ) {}

  async ingestTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, language?: string | null): Promise<TmdbTitleRecord | null> {
    const effectiveLanguage = normalizeMetadataLanguage(language) ?? 'en';
    const requestLanguage = toTmdbLanguageQuery(effectiveLanguage) ?? 'en-US';
    let payload: DetailPayload;
    try {
      payload = await this.tmdbClient.request(`/${mediaType}/${tmdbId}`, {
        append_to_response: 'images,videos,credits,recommendations,similar,reviews,external_ids,translations',
        include_image_language: buildTmdbIncludeImageLanguage(effectiveLanguage),
        language: requestLanguage,
      });
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) {
        await this.repository.markTitleNotFound(client, mediaType, tmdbId, 6);
        return null;
      }
      throw error;
    }

    const ttlHours = mediaType === 'movie' ? appConfig.cache.tmdb.movieTtlHours : appConfig.cache.tmdb.showTtlHours;
    const now = new Date();
    await withDeadlockRetry(() =>
      this.persistTitleTransaction(client, payload, mediaType, tmdbId, effectiveLanguage, ttlHours, now),
    );

    return this.repository.getTitle(client, mediaType, tmdbId, effectiveLanguage);
  }

  private async persistTitleTransaction(
    client: DbClient,
    payload: DetailPayload,
    mediaType: TmdbTitleType,
    tmdbId: number,
    effectiveLanguage: string,
    ttlHours: number,
    now: Date,
  ): Promise<void> {
    await client.query('BEGIN');
    try {
      await this.repository.upsertTitleCore(client, {
        mediaType,
        tmdbId,
        originalName: asString(payload.original_title) ?? asString(payload.original_name),
        originalLanguage: asString(payload.original_language) ?? 'en',
        releaseDate: asString(payload.release_date),
        firstAirDate: asString(payload.first_air_date),
        status: asString(payload.status),
        runtime: asNumber(payload.runtime),
        episodeRunTime: asArray(payload.episode_run_time).map((value) => Number(value)).filter((value) => Number.isFinite(value)),
        numberOfSeasons: asNumber(payload.number_of_seasons),
        numberOfEpisodes: asNumber(payload.number_of_episodes),
        externalIds: (payload.external_ids as DetailPayload | undefined) ?? {},
        genreIds: asArray(payload.genres).map((entry) => (entry as DetailPayload).id).filter((id): id is number => typeof id === 'number'),
        voteAverage: asNumber(payload.vote_average),
        voteCount: asNumber(payload.vote_count),
        popularity: asNumber(payload.popularity),
        adult: payload.adult === true,
        raw: payload,
        hydrationLevel: 'detail',
        fetchedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlHours * 3_600_000).toISOString(),
      });

      const translations: TmdbTranslationEntry[] = [{
        lang: effectiveLanguage.split('-')[0] || 'en',
        name: asString(payload.title) ?? asString(payload.name),
        overview: asString(payload.overview),
        tagline: asString(payload.tagline),
      }];
      for (const entry of asArray((payload.translations as DetailPayload | undefined)?.translations)) {
        const record = entry as DetailPayload;
        const lang = asString(record.iso_639_1);
        if (!lang) continue;
        const data = (record.data as DetailPayload | undefined) ?? {};
        translations.push({
          lang,
          name: asString(data.name) ?? asString(data.title),
          overview: asString(data.overview),
          tagline: asString(data.tagline),
        });
      }
      await this.repository.upsertTranslations(client, mediaType, tmdbId, translations);

      const imageTtlHours = mediaType === 'movie' ? appConfig.cache.tmdb.movieTtlHours : appConfig.cache.tmdb.showTtlHours;
      const imageExpiresAt = new Date(Date.now() + imageTtlHours * 3_600_000).toISOString();

      // Single canonical image per kind; first writer wins, later ingests keep it.
      await this.repository.insertImagesIfEmpty(client, mediaType, tmdbId, pickFirstImages(payload.images as DetailPayload | undefined), imageExpiresAt);

      await this.repository.replaceReviews(client, mediaType, tmdbId, 'tmdb', mapReviews(mediaType, tmdbId, payload));

      for (const [relationKind, key] of [['recommendation', 'recommendations'], ['similar', 'similar']] as const) {
        const results = (asArray((payload[key] as DetailPayload | undefined)?.results) as Record<string, unknown>[])
          .filter((entry) => typeof entry.id === 'number')
          .slice(0, 40);
        await this.repository.replaceRelations(
          client,
          mediaType,
          tmdbId,
          relationKind,
          results.map((entry, index) => ({
            targetMediaType: ((entry as DetailPayload).media_type === 'tv' || mediaType === 'tv' ? 'tv' : 'movie') as TmdbTitleType,
            targetTmdbId: (entry as DetailPayload).id as number,
            rank: index + 1,
          })),
        );
        await this.persistSummaries(client, results, mediaType, effectiveLanguage);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  async ingestSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<void> {
    const season = await this.tmdbClient.request(`/tv/${showTmdbId}/season/${seasonNumber}`);

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) + appConfig.cache.tmdb.seasonTtlHours * 3_600_000).toISOString();
    const episodes: TmdbEpisodeRecord[] = asArray(season.episodes).map((entry) => {
      const episode = entry as DetailPayload;
      return {
        showTmdbId,
        seasonNumber,
        episodeNumber: asNumber(episode.episode_number) ?? 0,
        tmdbId: asNumber(episode.id),
        name: asString(episode.name),
        overview: asString(episode.overview),
        airDate: asString(episode.air_date),
        runtime: asNumber(episode.runtime),
        stillPath: asString(episode.still_path),
        voteAverage: asNumber(episode.vote_average),
        raw: episode,
        fetchedAt: now,
        expiresAt,
      };
    }).filter((episode) => episode.episodeNumber > 0);

    await this.repository.replaceSeasonEpisodes(client, {
      showTmdbId,
      seasonNumber,
      seasonName: asString(season.name),
      seasonOverview: asString(season.overview),
      airDate: asString(season.air_date),
      posterPath: asString(season.poster_path),
      episodeCount: asNumber(season.episode_count),
      raw: season,
      episodes,
      fetchedAt: now,
      expiresAt,
    });
  }

  async ensureCollectionCached(client: DbClient, collectionId: number, language?: string | null): Promise<boolean> {
    const lang = normalizeMetadataLanguage(language)?.split('-')[0] ?? 'en';
    const existing = await this.repository.getRelatedTitles(client, 'collection', collectionId, 'collection_part', lang, 1);
    if (existing.length > 0) {
      return true;
    }

    const payload = await this.tmdbClient.request(`/collection/${collectionId}`, { language: toTmdbLanguageQuery(lang) });
    const parts = asArray(payload.parts).filter((entry) => typeof (entry as DetailPayload).id === 'number').slice(0, 60);
    await this.repository.replaceRelations(
      client,
      'collection',
      collectionId,
      'collection_part',
      parts.map((entry, index) => ({
        targetMediaType: (entry as DetailPayload).media_type === 'tv' ? 'tv' : 'movie',
        targetTmdbId: (entry as DetailPayload).id as number,
        rank: index + 1,
      })),
    );
    await this.persistSummaries(client, parts.map((entry) => entry as DetailPayload), 'movie', language);
    return parts.length > 0;
  }

  async ingestPerson(client: DbClient, personTmdbId: number, language?: string | null): Promise<TmdbPersonRecord | null> {
    const effectiveLanguage = normalizeMetadataLanguage(language) ?? 'en';
    let payload: DetailPayload;
    try {
      payload = await this.tmdbClient.request(`/person/${personTmdbId}`, {
        append_to_response: 'combined_credits,external_ids',
        language: toTmdbLanguageQuery(effectiveLanguage) ?? 'en-US',
      });
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }

    const name = asString(payload.name);
    if (!name) {
      return null;
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) + appConfig.cache.tmdb.movieTtlHours * 3_600_000).toISOString();

    await this.repository.upsertPerson(client, {
      tmdbPersonId: personTmdbId,
      name,
      knownForDepartment: asString(payload.known_for_department),
      biography: asString(payload.biography),
      birthday: asString(payload.birthday),
      deathday: asString(payload.deathday),
      placeOfBirth: asString(payload.place_of_birth),
      profilePath: asString(payload.profile_path),
      popularity: asNumber(payload.popularity),
      homepage: asString(payload.homepage),
      adult: payload.adult === true,
      alsoKnownAs: asArray(payload.also_known_as),
      raw: payload,
      fetchedAt: now,
      expiresAt,
    });

    const credits = (payload.combined_credits as DetailPayload | undefined) ?? {};
    const mappedCredits = [
      ...asArray(credits.cast).map((entry, index) => mapCredit(entry as DetailPayload, 'cast', index)),
      ...asArray(credits.crew).map((entry, index) => mapCredit(entry as DetailPayload, 'crew', index)),
    ].filter((credit) => credit.targetMediaType === 'movie' || credit.targetMediaType === 'tv');

    await this.repository.replacePersonCredits(client, personTmdbId, mappedCredits.slice(0, 120));
    await this.persistSummaries(client, [...asArray(credits.cast), ...asArray(credits.crew)].slice(0, 80).map((entry) => entry as DetailPayload), undefined, effectiveLanguage);
    return this.repository.getPerson(client, personTmdbId);
  }

  /** Persists lightweight search/discover/recommendation hits so future lookups stay local. */
  async persistSummaries(client: DbClient, items: DetailPayload[], fallbackMediaType?: TmdbTitleType, language?: string | null): Promise<void> {
    const rows = items
      .filter((item) => typeof item.id === 'number' && Number.isFinite(item.id))
      .map((item) => {
        const mediaType = (item.media_type === 'tv' || (!item.media_type && fallbackMediaType === 'tv')
          ? 'tv'
          : 'movie') as TmdbTitleType;
        return {
          mediaType,
          tmdbId: item.id as number,
          originalName: asString(item.original_title) ?? asString(item.original_name),
          releaseDate: asString(item.release_date),
          firstAirDate: asString(item.first_air_date),
          genreIds: asArray(item.genre_ids).map((value) => Number(value)).filter((value) => Number.isFinite(value)),
          voteAverage: asNumber(item.vote_average),
          voteCount: asNumber(item.vote_count),
          popularity: asNumber(item.popularity),
          adult: item.adult === true,
          title: asString(item.title) ?? asString(item.name),
          overview: asString(item.overview),
        };
      });

    if (!rows.length) {
      return;
    }

    await this.repository.upsertSummaryTitles(client, rows.map(({ title, overview, ...row }) => row));
    for (const row of rows) {
      if (row.title || row.overview) {
        await this.repository.upsertTranslations(client, row.mediaType, row.tmdbId, [{
          lang: 'en',
          name: row.title,
          overview: row.overview,
          tagline: null,
        }]);
      }
    }

    for (const row of rows) {
      await this.fetchImages(client, row.mediaType, row.tmdbId, language);
    }
  }

  async fetchImages(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, language?: string | null): Promise<void> {
    // Skip the API call when every canonical image kind is already stored.
    const kinds = ['poster', 'backdrop', 'logo'] as const;
    const missingKinds = await Promise.all(
      kinds.map(async (kind) => (await this.repository.hasImageKind(client, mediaType, tmdbId, kind) ? null : kind)),
    );
    const needed = missingKinds.filter((kind): kind is (typeof kinds)[number] => kind !== null);
    if (needed.length === 0) {
      return;
    }

    const effectiveLanguage = normalizeMetadataLanguage(language) ?? 'en';
    let payload: Record<string, unknown> | undefined;
    try {
      payload = await this.tmdbClient.request(`/${mediaType}/${tmdbId}/images`, {
        include_image_language: buildTmdbIncludeImageLanguage(effectiveLanguage),
      });
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 404) {
        return;
      }
      throw err;
    }

    const images = pickFirstImages(payload as DetailPayload | undefined, needed);

    if (images.length > 0) {
      const ttlHours = mediaType === 'movie' ? appConfig.cache.tmdb.movieTtlHours : appConfig.cache.tmdb.showTtlHours;
      const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
      await this.repository.insertImagesIfEmpty(client, mediaType, tmdbId, images, expiresAt);
    }
  }
}

/** Pick canonical images for the requested kinds: first-in-list for poster/logo, TMDB's backdrop rule for backdrops. */
function pickFirstImages(images: DetailPayload | undefined, kinds: ReadonlyArray<'poster' | 'backdrop' | 'logo'> = ['poster', 'backdrop', 'logo']): TmdbImageRecord[] {
  const picks: TmdbImageRecord[] = [];
  for (const [listKey, kind] of [['posters', 'poster'], ['logos', 'logo']] as const) {
    if (!kinds.includes(kind)) continue;
    const filePath = asArray(images?.[listKey])
      .map((entry) => asString((entry as DetailPayload).file_path))
      .find((path): path is string => path !== null);
    if (filePath) {
      picks.push({ kind, filePath });
    }
  }
  if (kinds.includes('backdrop')) {
    const backdropPath = pickBackdropFilePath(images);
    if (backdropPath) {
      picks.push({ kind: 'backdrop', filePath: backdropPath });
    }
  }
  return picks;
}

/**
 * TMDB's canonical backdrop: highest rated with no language, fallback to
 * highest rated overall. Matches what details and list endpoints return.
 */
function pickBackdropFilePath(images: DetailPayload | undefined): string | null {
  const entries = asArray(images?.backdrops)
    .map((entry) => {
      const record = entry as DetailPayload;
      const filePath = asString(record.file_path);
      if (!filePath) return null;
      const voteAverage = typeof record.vote_average === 'number' && Number.isFinite(record.vote_average)
        ? record.vote_average
        : 0;
      const voteCount = typeof record.vote_count === 'number' && Number.isFinite(record.vote_count)
        ? record.vote_count
        : 0;
      return { filePath, lang: asString(record.iso_639_1), voteAverage, voteCount };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const untagged = entries.filter((entry) => entry.lang === null);
  const pool = untagged.length > 0 ? untagged : entries;

  let best: (typeof pool)[number] | null = null;
  for (const entry of pool) {
    if (!best || entry.voteAverage > best.voteAverage
      || (entry.voteAverage === best.voteAverage && entry.voteCount > best.voteCount)) {
      best = entry;
    }
  }
  return best?.filePath ?? null;
}

function mapReviews(mediaType: TmdbTitleType, tmdbId: number, payload: DetailPayload) {
  return asArray((payload.reviews as DetailPayload | undefined)?.results)
    .map((entry) => {
      const review = entry as DetailPayload;
      const content = asString(review.content);
      const reviewKey = asString(review.id);
      if (!content || !reviewKey) return null;
      const details = (review.author_details as DetailPayload | undefined) ?? {};
      const ratingValue = asNumber(details.rating);
      return {
        mediaType,
        tmdbId,
        source: 'tmdb' as const,
        reviewKey,
        author: asString(review.author),
        authorUsername: asString(details.username),
        content,
        lang: asString(review.iso_639_1),
        url: asString(review.url),
        rating: ratingValue != null ? String(ratingValue) : null,
        avatarUrl: asString(details.avatar_path),
        createdAt: asString(review.created_at),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function mapCredit(entry: DetailPayload, kind: 'cast' | 'crew', index: number) {
  return {
    creditKind: kind,
    targetMediaType: (entry.media_type === 'tv' ? 'tv' : 'movie') as TmdbTitleType,
    targetTmdbId: asNumber(entry.id) ?? 0,
    character: asString(entry.character),
    department: asString(entry.department),
    job: asString(entry.job),
    rank: index + 1,
  };
}
