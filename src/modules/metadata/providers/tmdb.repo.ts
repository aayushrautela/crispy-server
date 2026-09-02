import type { DbClient } from '../../../lib/db.js';
import { normalizeDateOnlyString, requireDbIsoString } from '../../../lib/time.js';
import type {
  TmdbEpisodeRecord,
  TmdbImageRecord,
  TmdbPersonRecord,
  TmdbRelationKind,
  TmdbRelationTarget,
  TmdbReviewRecord,
  TmdbSeasonRecord,
  TmdbTitleRecord,
  TmdbTitleType,
  TmdbTranslationEntry,
} from './tmdb.types.js';

type Row = Record<string, unknown>;

const LANG = '$LANG$';

function titleColumns(): string {
  return `
    t.media_type, t.tmdb_id, t.original_name, t.original_language, t.release_date, t.first_air_date,
    t.status, t.runtime, t.episode_run_time, t.number_of_seasons, t.number_of_episodes,
    t.external_ids, t.genre_ids, t.vote_average, t.vote_count, t.popularity, t.adult,
    t.raw, t.hydration_level, t.fetched_at, t.expires_at,
    tr.name AS tr_name, tr.overview AS tr_overview, tr.tagline AS tr_tagline,
    ten.name AS ten_name, ten.overview AS ten_overview, ten.tagline AS ten_tagline,
    ip.file_path AS poster_pick, ib.file_path AS backdrop_pick, il.file_path AS logo_pick
  `;
}

function titleJoins(langParam: string, from = 'FROM tmdb_titles t'): string {
  return `
    ${from}
    LEFT JOIN tmdb_title_translations tr ON tr.media_type = t.media_type AND tr.tmdb_id = t.tmdb_id AND tr.lang = ${langParam}
    LEFT JOIN tmdb_title_translations ten ON ten.media_type = t.media_type AND ten.tmdb_id = t.tmdb_id AND ten.lang = 'en'
    LEFT JOIN LATERAL (
      SELECT i.file_path FROM tmdb_images i
      WHERE i.media_type = t.media_type AND i.tmdb_id = t.tmdb_id AND i.kind = 'poster'
      ORDER BY (i.iso_639_1 IS NULL) DESC, (i.iso_639_1 = ${langParam}) DESC NULLS LAST, i.vote_count DESC NULLS LAST
      LIMIT 1
    ) ip ON true
    LEFT JOIN LATERAL (
      SELECT i.file_path FROM tmdb_images i
      WHERE i.media_type = t.media_type AND i.tmdb_id = t.tmdb_id AND i.kind = 'backdrop'
      ORDER BY (i.iso_639_1 IS NULL) DESC, (i.iso_639_1 = $LANG$) DESC NULLS LAST, i.vote_count DESC NULLS LAST
      LIMIT 1
    ) ib ON true
    LEFT JOIN LATERAL (
      SELECT i.file_path FROM tmdb_images i
      WHERE i.media_type = t.media_type AND i.tmdb_id = t.tmdb_id AND i.kind = 'logo'
      ORDER BY (i.iso_639_1 = $LANG$) DESC NULLS LAST, (i.iso_639_1 = 'en') DESC NULLS LAST, (i.iso_639_1 IS NULL) DESC, i.vote_count DESC NULLS LAST
      LIMIT 1
    ) il ON true
  `.replaceAll(LANG, langParam);
}

function mapTitle(row: Row, language: string): TmdbTitleRecord {
  const name = (row.tr_name as string | null) ?? (row.ten_name as string | null) ?? (row.original_name as string | null);
  return {
    mediaType: String(row.media_type) as TmdbTitleType,
    tmdbId: Number(row.tmdb_id),
    language,
    name,
    originalName: typeof row.original_name === 'string' ? row.original_name : null,
    overview: (row.tr_overview as string | null) ?? (row.ten_overview as string | null),
    tagline: (row.tr_tagline as string | null) ?? (row.ten_tagline as string | null),
    releaseDate: normalizeDateOnlyString(row.release_date as Date | string | null | undefined),
    firstAirDate: normalizeDateOnlyString(row.first_air_date as Date | string | null | undefined),
    status: typeof row.status === 'string' ? row.status : null,
    posterPath: (row.poster_pick as string | null) ?? null,
    backdropPath: (row.backdrop_pick as string | null) ?? null,
    logoPath: (row.logo_pick as string | null) ?? null,
    runtime: row.runtime === null || row.runtime === undefined ? null : Number(row.runtime),
    episodeRunTime: Array.isArray(row.episode_run_time) ? row.episode_run_time.map((value) => Number(value)) : [],
    numberOfSeasons: row.number_of_seasons === null || row.number_of_seasons === undefined ? null : Number(row.number_of_seasons),
    numberOfEpisodes: row.number_of_episodes === null || row.number_of_episodes === undefined ? null : Number(row.number_of_episodes),
    externalIds: (row.external_ids as Record<string, unknown> | undefined) ?? {},
    genreIds: Array.isArray(row.genre_ids) ? row.genre_ids.map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n)) : [],
    voteAverage: row.vote_average === null || row.vote_average === undefined ? null : Number(row.vote_average),
    raw: (row.raw as Record<string, unknown> | undefined) ?? {},
    hydrationLevel: (row.hydration_level as TmdbTitleRecord['hydrationLevel']) ?? 'summary',
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'tmdb_titles.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'tmdb_titles.expires_at'),
  };
}

export class TmdbRepository {
  // ------------------------------------------------------------------ titles

  async getTitle(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, language?: string): Promise<TmdbTitleRecord | null> {
    const lang = language ?? 'en';
    const result = await client.query(
      `SELECT ${titleColumns()} ${titleJoins('$3')} WHERE t.media_type = $1 AND t.tmdb_id = $2`,
      [mediaType, tmdbId, lang],
    );
    return result.rows[0] ? mapTitle(result.rows[0], lang) : null;
  }

  async getTitles(client: DbClient, requests: Array<{ mediaType: TmdbTitleType; tmdbId: number }>, language: string): Promise<Map<string, TmdbTitleRecord>> {
    if (!requests.length) {
      return new Map();
    }

    const values: unknown[] = [language];
    const conditions = requests.map((req, index) => {
      const base = index * 2 + 2;
      values.push(req.mediaType, req.tmdbId);
      return `(t.media_type = $${base}::text AND t.tmdb_id = $${base + 1}::integer)`;
    });

    const result = await client.query(
      `SELECT ${titleColumns()} ${titleJoins('$1')} WHERE ${conditions.join(' OR ')}`,
      values,
    );

    const map = new Map<string, TmdbTitleRecord>();
    for (const row of result.rows) {
      const record = mapTitle(row, language);
      map.set(`${record.mediaType}:${record.tmdbId}`, record);
    }
    return map;
  }

  async searchTitles(client: DbClient, query: string, limit: number, mediaTypes: TmdbTitleType[], language: string): Promise<TmdbTitleRecord[]> {
    const result = await client.query(
      `SELECT DISTINCT ON (t.media_type, t.tmdb_id)
              ${titleColumns()},
              CASE
                 WHEN lower(coalesce(tr.name, '')) = lower($1) THEN 0
                 WHEN lower(coalesce(ten.name, '')) = lower($1) THEN 1
                 WHEN lower(coalesce(tr.name, '')) LIKE lower($2) THEN 2
                 WHEN lower(coalesce(ten.name, '')) LIKE lower($2) THEN 3
                 ELSE 4
              END AS rank_order,
              CASE WHEN tr.lang = $4 THEN 0 ELSE 1 END AS lang_order
       ${titleJoins('$4')}
       WHERE t.media_type = ANY($3::text[])
         AND (
           lower(coalesce(tr.name, '')) LIKE '%' || lower($1) || '%'
           OR lower(coalesce(ten.name, '')) LIKE '%' || lower($1) || '%'
           OR lower(coalesce(t.original_name, '')) LIKE '%' || lower($1) || '%'
         )
       ORDER BY t.media_type, t.tmdb_id, lang_order ASC, rank_order ASC`,
      [query, `${query}%`, mediaTypes, language],
    );

    return [...result.rows]
      .sort((left, right) => Number(left.rank_order) - Number(right.rank_order))
      .slice(0, limit)
      .map((row) => mapTitle(row, language));
  }

  async discoverTitlesByGenre(client: DbClient, mediaType: TmdbTitleType, genreId: number, limit: number, language: string): Promise<TmdbTitleRecord[]> {
    const result = await client.query(
      `SELECT ${titleColumns()} ${titleJoins('$4')}
       WHERE t.media_type = $1 AND t.genre_ids @> to_jsonb(ARRAY[$2::integer])
         AND coalesce(t.hydration_level, 'summary') <> 'not_found'
       ORDER BY t.popularity DESC NULLS LAST
       LIMIT $3`,
      [mediaType, genreId, limit, language],
    );
    return result.rows.map((row) => mapTitle(row, language));
  }

  async upsertTitleCore(client: DbClient, params: {
    mediaType: TmdbTitleType;
    tmdbId: number;
    originalName: string | null;
    originalLanguage: string;
    releaseDate: string | null;
    firstAirDate: string | null;
    status: string | null;
    runtime: number | null;
    episodeRunTime: number[];
    numberOfSeasons: number | null;
    numberOfEpisodes: number | null;
    externalIds: Record<string, unknown>;
    genreIds: number[];
    voteAverage: number | null;
    voteCount: number | null;
    popularity: number | null;
    adult: boolean;
    raw: Record<string, unknown>;
    hydrationLevel: 'summary' | 'detail' | 'not_found';
    fetchedAt: string;
    expiresAt: string;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO tmdb_titles (
          media_type, tmdb_id, original_name, original_language, release_date, first_air_date,
          status, runtime, episode_run_time, number_of_seasons, number_of_episodes,
          external_ids, genre_ids, vote_average, vote_count, popularity, adult,
          raw, hydration_level, fetched_at, expires_at
        )
        VALUES (
          $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9::jsonb, $10, $11,
          $12::jsonb, $13::jsonb, $14, $15, $16, $17,
          $18::jsonb, $19, $20::timestamptz, $21::timestamptz
        )
        ON CONFLICT (media_type, tmdb_id)
        DO UPDATE SET
          original_name = EXCLUDED.original_name,
          original_language = EXCLUDED.original_language,
          release_date = EXCLUDED.release_date,
          first_air_date = EXCLUDED.first_air_date,
          status = EXCLUDED.status,
          runtime = EXCLUDED.runtime,
          episode_run_time = EXCLUDED.episode_run_time,
          number_of_seasons = EXCLUDED.number_of_seasons,
          number_of_episodes = EXCLUDED.number_of_episodes,
          external_ids = EXCLUDED.external_ids,
          genre_ids = EXCLUDED.genre_ids,
          vote_average = EXCLUDED.vote_average,
          vote_count = EXCLUDED.vote_count,
          popularity = EXCLUDED.popularity,
          adult = EXCLUDED.adult,
          raw = EXCLUDED.raw,
          hydration_level = EXCLUDED.hydration_level,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at
      `,
      [
        params.mediaType,
        params.tmdbId,
        params.originalName,
        params.originalLanguage,
        params.releaseDate,
        params.firstAirDate,
        params.status,
        params.runtime,
        JSON.stringify(params.episodeRunTime),
        params.numberOfSeasons,
        params.numberOfEpisodes,
        JSON.stringify(params.externalIds),
        JSON.stringify(params.genreIds),
        params.voteAverage,
        params.voteCount,
        params.popularity,
        params.adult,
        JSON.stringify(params.raw),
        params.hydrationLevel,
        params.fetchedAt,
        params.expiresAt,
      ],
    );
  }

  async markTitleNotFound(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, ttlHours: number): Promise<void> {
    await client.query(
      `
        INSERT INTO tmdb_titles (media_type, tmdb_id, original_language, genre_ids, external_ids, episode_run_time, raw, hydration_level, fetched_at, expires_at)
        VALUES ($1, $2, 'en', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 'not_found', now(), now() + make_interval(hours => $3::int))
        ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
          hydration_level = 'not_found',
          fetched_at = now(),
          expires_at = now() + make_interval(hours => $3::int)
      `,
      [mediaType, tmdbId, Math.max(1, Math.round(ttlHours))],
    );
  }

  async upsertTranslations(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, entries: TmdbTranslationEntry[]): Promise<void> {
    if (!entries.length) {
      return;
    }

    const seen = new Set<string>();
    const uniqueEntries = entries.filter((entry) => {
      if (seen.has(entry.lang)) {
        return false;
      }
      seen.add(entry.lang);
      return true;
    });

    if (!uniqueEntries.length) {
      return;
    }

    const values: unknown[] = [];
    const tuples = uniqueEntries.map((entry, index) => {
      const base = index * 6;
      values.push(mediaType, tmdbId, entry.lang, entry.name, entry.overview, entry.tagline);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    await client.query(
      `INSERT INTO tmdb_title_translations (media_type, tmdb_id, lang, name, overview, tagline)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (media_type, tmdb_id, lang) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, tmdb_title_translations.name),
         overview = COALESCE(EXCLUDED.overview, tmdb_title_translations.overview),
         tagline = COALESCE(EXCLUDED.tagline, tmdb_title_translations.tagline),
         fetched_at = now()`,
      values,
    );
  }

  async replaceImages(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, images: TmdbImageRecord[], expiresAt?: string): Promise<void> {
    await client.query(`DELETE FROM tmdb_images WHERE media_type = $1 AND tmdb_id = $2`, [mediaType, tmdbId]);
    if (!images.length) {
      return;
    }
    await this.insertImages(client, mediaType, tmdbId, images, expiresAt);
  }

  async upsertImages(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, images: TmdbImageRecord[], expiresAt?: string): Promise<void> {
    if (!images.length) {
      return;
    }
    await this.insertImages(client, mediaType, tmdbId, images, expiresAt);
  }

  async hasImages(client: DbClient, mediaType: TmdbTitleType, tmdbId: number): Promise<boolean> {
    const result = await client.query(
      `SELECT EXISTS(SELECT 1 FROM tmdb_images WHERE media_type = $1 AND tmdb_id = $2 AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1) AS has_images`,
      [mediaType, tmdbId],
    );
    return Boolean(result.rows[0]?.has_images);
  }

  async purgeExpiredImages(client: DbClient, limit: number): Promise<void> {
    await client.query(
      `DELETE FROM tmdb_images WHERE expires_at IS NOT NULL AND expires_at < NOW() LIMIT $1`,
      [limit],
    );
  }

  private async insertImages(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, images: TmdbImageRecord[], expiresAt?: string): Promise<void> {
    const values: unknown[] = [];
    const tuples = images.map((image, index) => {
      const base = index * 6;
      values.push(mediaType, tmdbId, image.kind, image.filePath, image.iso6391, expiresAt ?? null);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    await client.query(
      `INSERT INTO tmdb_images (media_type, tmdb_id, kind, file_path, iso_639_1, expires_at)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (media_type, tmdb_id, kind, file_path) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      values,
    );
  }

  async replaceReviews(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, source: 'tmdb' | 'trakt', reviews: TmdbReviewRecord[]): Promise<void> {
    await client.query(`DELETE FROM tmdb_reviews WHERE media_type = $1 AND tmdb_id = $2 AND source = $3`, [mediaType, tmdbId, source]);
    if (!reviews.length) {
      return;
    }

    const values: unknown[] = [];
    const tuples = reviews.map((review, index) => {
      const base = index * 11;
      values.push(review.mediaType, review.tmdbId, review.source, review.reviewKey, review.author);
      values.push(review.authorUsername, review.content, review.lang, review.url, review.rating);
      values.push(review.avatarUrl);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`;
    });

    await client.query(
      `INSERT INTO tmdb_reviews (media_type, tmdb_id, source, review_key, author, author_username, content, lang, url, rating, avatar_url)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (media_type, tmdb_id, source, review_key) DO NOTHING`,
      values,
    );
  }

  async getReviews(client: DbClient, mediaType: TmdbTitleType, tmdbId: number, limit = 15): Promise<TmdbReviewRecord[]> {
    const result = await client.query(
      `SELECT media_type, tmdb_id, source, review_key, author, author_username, content, lang, url, rating, avatar_url, created_at
       FROM tmdb_reviews
       WHERE media_type = $1 AND tmdb_id = $2
       ORDER BY created_at DESC NULLS LAST
       LIMIT $3`,
      [mediaType, tmdbId, limit],
    );
    return result.rows.map(mapReviewRow);
  }

  async replaceRelations(client: DbClient, sourceMediaType: string, sourceTmdbId: number, relationKind: TmdbRelationKind, targets: TmdbRelationTarget[]): Promise<void> {
    await client.query(
      `DELETE FROM tmdb_title_relations WHERE source_media_type = $1 AND source_tmdb_id = $2 AND relation_kind = $3`,
      [sourceMediaType, sourceTmdbId, relationKind],
    );
    if (!targets.length) {
      return;
    }

    const values: unknown[] = [];
    const tuples = targets.map((target, index) => {
      const base = index * 6;
      values.push(sourceMediaType, sourceTmdbId, relationKind, target.targetMediaType, target.targetTmdbId, target.rank);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    await client.query(
      `INSERT INTO tmdb_title_relations (source_media_type, source_tmdb_id, relation_kind, target_media_type, target_tmdb_id, rank)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (source_media_type, source_tmdb_id, relation_kind, target_media_type, target_tmdb_id) DO UPDATE SET
         rank = EXCLUDED.rank`,
      values,
    );
  }

  async getRelatedTitles(client: DbClient, sourceMediaType: string, sourceTmdbId: number, relationKind: TmdbRelationKind, language: string, limit = 40): Promise<TmdbTitleRecord[]> {
    const result = await client.query(
      `SELECT ${titleColumns()} ${titleJoins('$4', 'FROM tmdb_title_relations rel JOIN tmdb_titles t ON t.media_type = rel.target_media_type AND t.tmdb_id = rel.target_tmdb_id')}
       WHERE rel.source_media_type = $1 AND rel.source_tmdb_id = $2 AND rel.relation_kind = $3
         AND coalesce(t.hydration_level, 'summary') <> 'not_found'
       ORDER BY rel.rank ASC
       LIMIT $5`,
      [sourceMediaType, sourceTmdbId, relationKind, language, limit],
    );
    return result.rows.map((row) => mapTitle(row, language));
  }

  async upsertSummaryTitles(client: DbClient, rows: Array<{
    mediaType: TmdbTitleType;
    tmdbId: number;
    originalName: string | null;
    releaseDate: string | null;
    firstAirDate: string | null;
    genreIds: number[];
    voteAverage: number | null;
    voteCount: number | null;
    popularity: number | null;
    adult: boolean;
  }>): Promise<void> {
    for (const row of rows) {
      await client.query(
        `
          INSERT INTO tmdb_titles (
            media_type, tmdb_id, original_name, original_language, release_date, first_air_date,
            genre_ids, vote_average, vote_count, popularity, adult,
            raw, hydration_level, fetched_at, expires_at
          )
          VALUES ($1, $2, $3, 'en', $4::date, $5::date, $6::jsonb, $7, $8, $9, $10, '{}'::jsonb, 'summary', now(), now() + interval '90 days')
          ON CONFLICT (media_type, tmdb_id) DO NOTHING
        `,
        [
          row.mediaType,
          row.tmdbId,
          row.originalName,
          row.releaseDate,
          row.firstAirDate,
          JSON.stringify(row.genreIds),
          row.voteAverage,
          row.voteCount,
          row.popularity,
          row.adult,
        ],
      );
    }
  }

  // -------------------------------------------------------- seasons/episodes

  async getSeason(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbSeasonRecord | null> {
    const result = await client.query(
      `SELECT show_tmdb_id, season_number, name, overview, air_date, poster_path, episode_count, raw, fetched_at, expires_at
       FROM tmdb_tv_seasons WHERE show_tmdb_id = $1 AND season_number = $2`,
      [showTmdbId, seasonNumber],
    );
    return result.rows[0] ? mapSeason(result.rows[0]) : null;
  }

  async getSeasons(client: DbClient, requests: Array<{ showTmdbId: number; seasonNumber: number }>): Promise<Map<string, TmdbSeasonRecord>> {
    if (requests.length === 0) return new Map();
    const seen = new Map<string, { showTmdbId: number; seasonNumber: number }>();
    for (const request of requests) {
      seen.set(`${request.showTmdbId}:${request.seasonNumber}`, request);
    }
    const conditions: string[] = [];
    const params: (number | string)[] = [];
    for (const request of seen.values()) {
      conditions.push(`(show_tmdb_id = $${params.length + 1} AND season_number = $${params.length + 2})`);
      params.push(request.showTmdbId, request.seasonNumber);
    }
    const result = await client.query(
      `SELECT show_tmdb_id, season_number, name, overview, air_date, poster_path, episode_count, raw, fetched_at, expires_at
       FROM tmdb_tv_seasons WHERE ${conditions.join(' OR ')}`,
      params,
    );
    const records = new Map<string, TmdbSeasonRecord>();
    for (const row of result.rows) {
      const mapped = mapSeason(row);
      records.set(`${mapped.showTmdbId}:${mapped.seasonNumber}`, mapped);
    }
    return records;
  }

  async getEpisode(client: DbClient, showTmdbId: number, seasonNumber: number, episodeNumber: number): Promise<TmdbEpisodeRecord | null> {
    const result = await client.query(
      `SELECT show_tmdb_id, season_number, episode_number, tmdb_id, name, overview, air_date,
              runtime, still_path, vote_average, raw, fetched_at, expires_at
       FROM tmdb_tv_episodes
       WHERE show_tmdb_id = $1 AND season_number = $2 AND episode_number = $3`,
      [showTmdbId, seasonNumber, episodeNumber],
    );
    return result.rows[0] ? mapEpisode(result.rows[0]) : null;
  }

  async getSeasonEpisodes(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<TmdbEpisodeRecord[]> {
    const result = await client.query(
      `SELECT show_tmdb_id, season_number, episode_number, tmdb_id, name, overview, air_date,
              runtime, still_path, vote_average, raw, fetched_at, expires_at
       FROM tmdb_tv_episodes
       WHERE show_tmdb_id = $1 AND season_number = $2
       ORDER BY episode_number ASC`,
      [showTmdbId, seasonNumber],
    );
    return result.rows.map(mapEpisode);
  }

  async getEpisodes(client: DbClient, requests: Array<{ showTmdbId: number; seasonNumber: number; episodeNumber: number }>): Promise<Map<string, TmdbEpisodeRecord>> {
    if (!requests.length) {
      return new Map();
    }

    const values: unknown[] = [];
    const conditions = requests.map((req, index) => {
      const base = index * 3;
      values.push(req.showTmdbId, req.seasonNumber, req.episodeNumber);
      return `(show_tmdb_id = $${base + 1}::integer AND season_number = $${base + 2}::integer AND episode_number = $${base + 3}::integer)`;
    });

    const result = await client.query(
      `SELECT show_tmdb_id, season_number, episode_number, tmdb_id, name, overview, air_date,
              runtime, still_path, vote_average, raw, fetched_at, expires_at
       FROM tmdb_tv_episodes
       WHERE ${conditions.join(' OR ')}`,
      values,
    );

    const map = new Map<string, TmdbEpisodeRecord>();
    for (const row of result.rows) {
      const record = mapEpisode(row);
      map.set(`${record.showTmdbId}:${record.seasonNumber}:${record.episodeNumber}`, record);
    }
    return map;
  }

  async replaceSeasonEpisodes(client: DbClient, params: {
    showTmdbId: number;
    seasonNumber: number;
    seasonName: string | null;
    seasonOverview: string | null;
    airDate: string | null;
    posterPath: string | null;
    episodeCount: number | null;
    raw: Record<string, unknown>;
    episodes: TmdbEpisodeRecord[];
    fetchedAt: string;
    expiresAt: string;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO tmdb_tv_seasons (
          show_tmdb_id, season_number, name, overview, air_date, poster_path, episode_count, raw, fetched_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8::jsonb, $9::timestamptz, $10::timestamptz)
        ON CONFLICT (show_tmdb_id, season_number)
        DO UPDATE SET
          name = EXCLUDED.name,
          overview = EXCLUDED.overview,
          air_date = EXCLUDED.air_date,
          poster_path = EXCLUDED.poster_path,
          episode_count = EXCLUDED.episode_count,
          raw = EXCLUDED.raw,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at
      `,
      [
        params.showTmdbId,
        params.seasonNumber,
        params.seasonName,
        params.seasonOverview,
        params.airDate,
        params.posterPath,
        params.episodeCount,
        JSON.stringify(params.raw),
        params.fetchedAt,
        params.expiresAt,
      ],
    );

    await client.query(`DELETE FROM tmdb_tv_episodes WHERE show_tmdb_id = $1 AND season_number = $2`, [params.showTmdbId, params.seasonNumber]);

    if (params.episodes.length > 0) {
      const values: unknown[] = [];
      const tuples = params.episodes.map((episode, index) => {
        const base = index * 13;
        values.push(
          episode.showTmdbId, episode.seasonNumber, episode.episodeNumber,
          episode.tmdbId, episode.name, episode.overview, episode.airDate,
          episode.runtime, episode.stillPath, episode.voteAverage,
          JSON.stringify(episode.raw), episode.fetchedAt, episode.expiresAt,
        );
        return `($${base + 1}::integer, $${base + 2}::integer, $${base + 3}::integer, $${base + 4}::integer, $${base + 5}::text, $${base + 6}::text, $${base + 7}::date, $${base + 8}::integer, $${base + 9}::text, $${base + 10}::numeric, $${base + 11}::jsonb, $${base + 12}::timestamptz, $${base + 13}::timestamptz)`;
      });

      await client.query(
        `INSERT INTO tmdb_tv_episodes (
          show_tmdb_id, season_number, episode_number, tmdb_id, name, overview, air_date,
          runtime, still_path, vote_average, raw, fetched_at, expires_at
        ) VALUES ${tuples.join(', ')}`,
        values,
      );
    }
  }

  // ------------------------------------------------------------------ people

  async getPerson(client: DbClient, personTmdbId: number): Promise<TmdbPersonRecord | null> {
    const result = await client.query(
      `SELECT tmdb_id, name, known_for_department, biography, birthday, deathday, place_of_birth,
              profile_path, popularity, homepage, adult, also_known_as, raw, fetched_at, expires_at
       FROM tmdb_people WHERE tmdb_id = $1`,
      [personTmdbId],
    );
    return result.rows[0] ? mapPerson(result.rows[0]) : null;
  }

  async searchPeople(client: DbClient, query: string, limit: number): Promise<TmdbPersonRecord[]> {
    const result = await client.query(
      `SELECT tmdb_id, name, known_for_department, biography, birthday, deathday, place_of_birth,
              profile_path, popularity, homepage, adult, also_known_as, raw, fetched_at, expires_at
       FROM tmdb_people
       WHERE lower(name) LIKE '%' || lower($1) || '%'
       ORDER BY popularity DESC NULLS LAST
       LIMIT $2`,
      [query, limit],
    );
    return result.rows.map(mapPerson);
  }

  async upsertPerson(client: DbClient, params: {
    tmdbPersonId: number;
    name: string;
    knownForDepartment: string | null;
    biography: string | null;
    birthday: string | null;
    deathday: string | null;
    placeOfBirth: string | null;
    profilePath: string | null;
    popularity: number | null;
    homepage: string | null;
    adult: boolean | null;
    alsoKnownAs: unknown[];
    raw: Record<string, unknown>;
    fetchedAt: string;
    expiresAt: string;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO tmdb_people (
          tmdb_id, name, known_for_department, biography, birthday, deathday, place_of_birth,
          profile_path, popularity, homepage, adult, also_known_as, raw, fetched_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::timestamptz, $15::timestamptz)
        ON CONFLICT (tmdb_id) DO UPDATE SET
          name = EXCLUDED.name,
          known_for_department = EXCLUDED.known_for_department,
          biography = EXCLUDED.biography,
          birthday = EXCLUDED.birthday,
          deathday = EXCLUDED.deathday,
          place_of_birth = EXCLUDED.place_of_birth,
          profile_path = EXCLUDED.profile_path,
          popularity = EXCLUDED.popularity,
          homepage = EXCLUDED.homepage,
          adult = EXCLUDED.adult,
          also_known_as = EXCLUDED.also_known_as,
          raw = EXCLUDED.raw,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at
      `,
      [
        params.tmdbPersonId,
        params.name,
        params.knownForDepartment,
        params.biography,
        params.birthday,
        params.deathday,
        params.placeOfBirth,
        params.profilePath,
        params.popularity,
        params.homepage,
        params.adult,
        JSON.stringify(params.alsoKnownAs),
        JSON.stringify(params.raw),
        params.fetchedAt,
        params.expiresAt,
      ],
    );
  }

  async replacePersonCredits(client: DbClient, personTmdbId: number, credits: Array<{
    creditKind: 'cast' | 'crew';
    targetMediaType: TmdbTitleType;
    targetTmdbId: number;
    character: string | null;
    department: string | null;
    job: string | null;
    rank: number;
  }>): Promise<void> {
    await client.query(`DELETE FROM tmdb_person_credits WHERE person_tmdb_id = $1`, [personTmdbId]);
    if (!credits.length) {
      return;
    }

    const values: unknown[] = [];
    const tuples = credits.map((credit, index) => {
      const base = index * 8;
      values.push(personTmdbId, credit.creditKind, credit.targetMediaType, credit.targetTmdbId, credit.character, credit.department, credit.job, credit.rank);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    });

    await client.query(
      `INSERT INTO tmdb_person_credits (person_tmdb_id, credit_kind, target_media_type, target_tmdb_id, character, department, job, rank)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (person_tmdb_id, credit_kind, target_media_type, target_tmdb_id) DO NOTHING`,
      values,
    );
  }

  async getPersonKnownFor(client: DbClient, personTmdbId: number, language: string, limit = 50): Promise<Array<{ title: TmdbTitleRecord; character: string | null; job: string | null }>> {
    const result = await client.query(
      `SELECT pc.character, pc.job AS pc_job, ${titleColumns()} ${titleJoins('$2', 'FROM tmdb_person_credits pc JOIN tmdb_titles t ON t.media_type = pc.target_media_type AND t.tmdb_id = pc.target_tmdb_id')}
       WHERE pc.person_tmdb_id = $1 AND coalesce(t.hydration_level, 'summary') <> 'not_found'
       ORDER BY coalesce(t.popularity, 0) DESC
       LIMIT $3`,
      [personTmdbId, language, limit],
    );
    return result.rows.map((row) => ({
      title: mapTitle(row, language),
      character: typeof row.character === 'string' ? row.character : null,
      job: typeof row.pc_job === 'string' ? row.pc_job : null,
    }));
  }

  // ------------------------------------------------------------ external ids

  async findByExternalId(client: DbClient, params: { source: string; externalId: string; mediaType: string }): Promise<{ tmdbId: number | null; notFoundAt: Date | null } | null> {
    const result = await client.query(
      `SELECT tmdb_id, not_found_at FROM tmdb_external_ids
       WHERE source = $1 AND external_id = $2 AND media_type = $3`,
      [params.source, params.externalId, params.mediaType],
    );
    const row = result.rows[0];
    return row ? { tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id), notFoundAt: row.not_found_at ? new Date(row.not_found_at as string) : null } : null;
  }

  async upsertExternalId(client: DbClient, params: { source: string; externalId: string; mediaType: string; tmdbId: number; raw?: Record<string, unknown> }): Promise<void> {
    await client.query(
      `INSERT INTO tmdb_external_ids (source, external_id, media_type, tmdb_id, raw, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (source, external_id, media_type) DO UPDATE SET
         tmdb_id = EXCLUDED.tmdb_id,
         raw = EXCLUDED.raw,
         not_found_at = NULL,
         updated_at = now()`,
      [params.source, params.externalId, params.mediaType, params.tmdbId, JSON.stringify(params.raw ?? {})],
    );
  }

  async markExternalIdNotFound(client: DbClient, params: { source: string; externalId: string; mediaType: string }): Promise<void> {
    await client.query(
      `INSERT INTO tmdb_external_ids (source, external_id, media_type, tmdb_id, not_found_at, updated_at)
       VALUES ($1, $2, $3, NULL, now(), now())
       ON CONFLICT (source, external_id, media_type) DO UPDATE SET
         not_found_at = now(),
         updated_at = now()`,
      [params.source, params.externalId, params.mediaType],
    );
  }

  // ------------------------------------------------------------------ purge

  async purgeExpiredEntities(client: DbClient, limit: number): Promise<number> {
    let purged = 0;

    for (const table of ['tmdb_titles', 'tmdb_tv_seasons', 'tmdb_tv_episodes']) {
      const result = await client.query(
        `WITH deleted AS (
           DELETE FROM ${table}
           WHERE ctid IN (
             SELECT ctid FROM ${table} WHERE expires_at < now() LIMIT $1
           )
           RETURNING 1
         ) SELECT count(*)::integer AS count FROM deleted`,
        [limit],
      );
      purged += Number(result.rows[0]?.count ?? 0);
    }

    return purged;
  }
}

function mapEpisode(row: Row): TmdbEpisodeRecord {
  return {
    showTmdbId: Number(row.show_tmdb_id),
    seasonNumber: Number(row.season_number),
    episodeNumber: Number(row.episode_number),
    tmdbId: row.tmdb_id === null || row.tmdb_id === undefined ? null : Number(row.tmdb_id),
    name: typeof row.name === 'string' ? row.name : null,
    overview: typeof row.overview === 'string' ? row.overview : null,
    airDate: normalizeDateOnlyString(row.air_date as Date | string | null | undefined),
    runtime: row.runtime === null || row.runtime === undefined ? null : Number(row.runtime),
    stillPath: typeof row.still_path === 'string' ? row.still_path : null,
    voteAverage: row.vote_average === null || row.vote_average === undefined ? null : Number(row.vote_average),
    raw: (row.raw as Record<string, unknown> | undefined) ?? {},
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'tmdb_tv_episodes.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'tmdb_tv_episodes.expires_at'),
  };
}

function mapSeason(row: Row): TmdbSeasonRecord {
  return {
    showTmdbId: Number(row.show_tmdb_id),
    seasonNumber: Number(row.season_number),
    name: typeof row.name === 'string' ? row.name : null,
    overview: typeof row.overview === 'string' ? row.overview : null,
    airDate: normalizeDateOnlyString(row.air_date as Date | string | null | undefined),
    posterPath: typeof row.poster_path === 'string' ? row.poster_path : null,
    episodeCount: row.episode_count === null || row.episode_count === undefined ? null : Number(row.episode_count),
    raw: (row.raw as Record<string, unknown> | undefined) ?? {},
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'tmdb_tv_seasons.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'tmdb_tv_seasons.expires_at'),
  };
}

function mapPerson(row: Row): TmdbPersonRecord {
  return {
    tmdbPersonId: Number(row.tmdb_id),
    name: String(row.name ?? ''),
    knownForDepartment: typeof row.known_for_department === 'string' ? row.known_for_department : null,
    biography: typeof row.biography === 'string' ? row.biography : null,
    birthday: normalizeDateOnlyString(row.birthday as Date | string | null | undefined),
    deathday: normalizeDateOnlyString(row.deathday as Date | string | null | undefined),
    placeOfBirth: typeof row.place_of_birth === 'string' ? row.place_of_birth : null,
    profilePath: typeof row.profile_path === 'string' ? row.profile_path : null,
    popularity: row.popularity === null || row.popularity === undefined ? 0 : Number(row.popularity),
    homepage: typeof row.homepage === 'string' ? row.homepage : null,
    raw: (row.raw as Record<string, unknown> | undefined) ?? null,
    fetchedAt: requireDbIsoString(row.fetched_at as Date | string | null | undefined, 'tmdb_people.fetched_at'),
    expiresAt: requireDbIsoString(row.expires_at as Date | string | null | undefined, 'tmdb_people.expires_at'),
  };
}

function mapReviewRow(row: Row): TmdbReviewRecord {
  return {
    mediaType: String(row.media_type) as TmdbTitleType,
    tmdbId: Number(row.tmdb_id),
    source: String(row.source) as 'tmdb' | 'trakt',
    reviewKey: String(row.review_key),
    author: typeof row.author === 'string' ? row.author : null,
    authorUsername: typeof row.author_username === 'string' ? row.author_username : null,
    content: String(row.content ?? ''),
    lang: typeof row.lang === 'string' ? row.lang : null,
    url: typeof row.url === 'string' ? row.url : null,
    rating: typeof row.rating === 'string' ? row.rating : null,
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    createdAt: normalizeDateOnlyString(row.created_at as Date | string | null | undefined),
  };
}
