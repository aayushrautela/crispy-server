import type { DbClient } from '../../lib/db.js';
import type { MetadataTitleMediaType } from '../metadata/metadata-card.types.js';
import type { SupportedProvider } from '../identity/media-key.js';

export type WatchMediaCardCacheRecord = {
  mediaKey: string;
  mediaType: string;
  titleProvider: SupportedProvider;
  titleProviderId: string;
  titleMediaType: MetadataTitleMediaType;
  title: string;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  stillUrl: string | null;
  logoUrl: string | null;
  trailerUrl: string | null;
  trailerThumbnailUrl: string | null;
  posterColor: string | null;
  backdropColor: string | null;
  releaseYear: number | null;
  rating: number | null;
  maturityRating: string | null;
  genres: string[];
  language: string;
};

export class WatchMediaCardCacheRepository {
  async upsert(client: DbClient, params: {
    mediaKey: string;
    mediaType: string;
    titleProvider: SupportedProvider;
    titleProviderId: string;
    titleMediaType: MetadataTitleMediaType;
    title: string;
    subtitle?: string | null;
    posterUrl: string | null;
    backdropUrl?: string | null;
    stillUrl?: string | null;
    logoUrl?: string | null;
    trailerUrl?: string | null;
    trailerThumbnailUrl?: string | null;
    posterColor?: string | null;
    backdropColor?: string | null;
    releaseYear?: number | null;
    rating?: number | null;
    maturityRating?: string | null;
    genres?: string[] | null;
    language?: string;
  }): Promise<void> {
    const effectiveLanguage = params.language ?? 'en-US';
    await client.query(
      `
        INSERT INTO watch_media_card_cache (
          media_key, media_type, title_provider, title_provider_id, title_media_type,
          title, subtitle, poster_url, backdrop_url, still_url, logo_url,
          trailer_url, trailer_thumbnail_url, poster_color, backdrop_color,
          release_year, rating, maturity_rating, genres, language, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, now())
        ON CONFLICT (media_key, language)
        DO UPDATE SET
          media_type = EXCLUDED.media_type,
          title_provider = EXCLUDED.title_provider,
          title_provider_id = EXCLUDED.title_provider_id,
          title_media_type = EXCLUDED.title_media_type,
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          poster_url = EXCLUDED.poster_url,
          backdrop_url = EXCLUDED.backdrop_url,
          still_url = EXCLUDED.still_url,
          logo_url = EXCLUDED.logo_url,
          trailer_url = EXCLUDED.trailer_url,
          trailer_thumbnail_url = EXCLUDED.trailer_thumbnail_url,
          poster_color = EXCLUDED.poster_color,
          backdrop_color = EXCLUDED.backdrop_color,
          release_year = EXCLUDED.release_year,
          rating = EXCLUDED.rating,
          maturity_rating = EXCLUDED.maturity_rating,
          genres = EXCLUDED.genres,
          updated_at = now()
      `,
      [
        params.mediaKey,
        params.mediaType,
        params.titleProvider,
        params.titleProviderId,
        params.titleMediaType,
        params.title,
        params.subtitle ?? null,
        params.posterUrl,
        params.backdropUrl ?? null,
        params.stillUrl ?? null,
        params.logoUrl ?? null,
        params.trailerUrl ?? null,
        params.trailerThumbnailUrl ?? null,
        params.posterColor ?? null,
        params.backdropColor ?? null,
        params.releaseYear ?? null,
        params.rating ?? null,
        params.maturityRating ?? null,
        JSON.stringify(normalizeGenres(params.genres)),
        effectiveLanguage,
      ],
    );
  }

  async getByMediaKeys(client: DbClient, mediaKeys: string[], language?: string): Promise<Map<string, WatchMediaCardCacheRecord>> {
    if (!mediaKeys.length) {
      return new Map();
    }

    const effectiveLanguage = language ?? 'en-US';
    const requestedRecords = await this.getByMediaKeysForLanguage(client, mediaKeys, effectiveLanguage);
    if (effectiveLanguage === 'en-US' || requestedRecords.size === mediaKeys.length) {
      return requestedRecords;
    }

    const missingMediaKeys = mediaKeys.filter((mediaKey) => !requestedRecords.has(mediaKey));
    const fallbackRecords = await this.getByMediaKeysForLanguage(client, missingMediaKeys, 'en-US');
    return new Map([...fallbackRecords, ...requestedRecords]);
  }

  private async getByMediaKeysForLanguage(client: DbClient, mediaKeys: string[], language: string): Promise<Map<string, WatchMediaCardCacheRecord>> {
    if (!mediaKeys.length) {
      return new Map();
    }

    const result = await client.query(
      `
      SELECT media_key, media_type, title_provider, title_provider_id, title_media_type,
             title, subtitle, poster_url, backdrop_url, still_url, logo_url,
             trailer_url, trailer_thumbnail_url, poster_color, backdrop_color,
             release_year, rating, maturity_rating, genres, language
      FROM watch_media_card_cache
        WHERE media_key = ANY($1::text[])
          AND language = $2
      `,
      [mediaKeys, language],
    );

    return new Map(
      result.rows.flatMap((row) => {
        if (
          typeof row.media_key !== 'string'
          || typeof row.media_type !== 'string'
          || typeof row.title_provider !== 'string'
          || typeof row.title_provider_id !== 'string'
          || typeof row.title_media_type !== 'string'
          || typeof row.title !== 'string'
        ) {
          return [];
        }

        if (row.title_provider !== 'tmdb') {
          return [];
        }

        if (row.title_media_type !== 'movie' && row.title_media_type !== 'show') {
          return [];
        }

        return [[
          row.media_key,
          {
            mediaKey: row.media_key,
            mediaType: row.media_type,
            titleProvider: row.title_provider,
            titleProviderId: row.title_provider_id,
            titleMediaType: row.title_media_type,
            title: row.title,
            subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
            posterUrl: typeof row.poster_url === 'string' ? row.poster_url : null,
            backdropUrl: typeof row.backdrop_url === 'string' ? row.backdrop_url : null,
            stillUrl: typeof row.still_url === 'string' ? row.still_url : null,
            logoUrl: typeof row.logo_url === 'string' ? row.logo_url : null,
            trailerUrl: typeof row.trailer_url === 'string' ? row.trailer_url : null,
            trailerThumbnailUrl: typeof row.trailer_thumbnail_url === 'string' ? row.trailer_thumbnail_url : null,
            posterColor: typeof row.poster_color === 'string' ? row.poster_color : null,
            backdropColor: typeof row.backdrop_color === 'string' ? row.backdrop_color : null,
            releaseYear: row.release_year === null ? null : Number(row.release_year),
            rating: row.rating === null ? null : Number(row.rating),
            maturityRating: typeof row.maturity_rating === 'string' ? row.maturity_rating : null,
            genres: parseGenres(row.genres),
            language: typeof row.language === 'string' ? row.language : 'en',
          } satisfies WatchMediaCardCacheRecord,
        ]];
      }),
    );
  }
}

function parseGenres(value: unknown): string[] {
  return normalizeGenres(value);
}

function normalizeGenres(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((genre): genre is string => typeof genre === 'string' && genre.trim() !== '');
}
