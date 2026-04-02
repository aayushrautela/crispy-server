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
  posterUrl: string;
  backdropUrl: string | null;
  releaseYear: number | null;
  rating: number | null;
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
    posterUrl: string;
    backdropUrl?: string | null;
    releaseYear?: number | null;
    rating?: number | null;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO watch_media_card_cache (
          media_key, media_type, title_provider, title_provider_id, title_media_type,
          title, subtitle, poster_url, backdrop_url, release_year, rating, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        ON CONFLICT (media_key)
        DO UPDATE SET
          media_type = EXCLUDED.media_type,
          title_provider = EXCLUDED.title_provider,
          title_provider_id = EXCLUDED.title_provider_id,
          title_media_type = EXCLUDED.title_media_type,
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          poster_url = EXCLUDED.poster_url,
          backdrop_url = EXCLUDED.backdrop_url,
          release_year = EXCLUDED.release_year,
          rating = EXCLUDED.rating,
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
        params.releaseYear ?? null,
        params.rating ?? null,
      ],
    );
  }

  async getByMediaKeys(client: DbClient, mediaKeys: string[]): Promise<Map<string, WatchMediaCardCacheRecord>> {
    if (!mediaKeys.length) {
      return new Map();
    }

    const result = await client.query(
      `
        SELECT media_key, media_type, title_provider, title_provider_id, title_media_type,
               title, subtitle, poster_url, backdrop_url, release_year, rating
        FROM watch_media_card_cache
        WHERE media_key = ANY($1::text[])
      `,
      [mediaKeys],
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
          || typeof row.poster_url !== 'string'
        ) {
          return [];
        }

        if (row.title_provider !== 'tmdb' && row.title_provider !== 'tvdb' && row.title_provider !== 'kitsu') {
          return [];
        }

        if (row.title_media_type !== 'movie' && row.title_media_type !== 'show' && row.title_media_type !== 'anime') {
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
            posterUrl: row.poster_url,
            backdropUrl: typeof row.backdrop_url === 'string' ? row.backdrop_url : null,
            releaseYear: row.release_year === null ? null : Number(row.release_year),
            rating: row.rating === null ? null : Number(row.rating),
          } satisfies WatchMediaCardCacheRecord,
        ]];
      }),
    );
  }
}
