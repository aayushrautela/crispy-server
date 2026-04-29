import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import type { ProfileLanguageProfile, LanguageRatio } from './language-profile.types.js';

export class LanguageProfileRepository {
  async getByProfile(client: DbClient, profileId: string): Promise<ProfileLanguageProfile | null> {
    const result = await client.query(
      `
        SELECT profile_id, status, window_size, sample_size, ratios, primary_language, computed_at
        FROM profile_language_profiles
        WHERE profile_id = $1::uuid
      `,
      [profileId],
    );

    if (!result.rows[0]) {
      return null;
    }

    const row = result.rows[0];
    return {
      profileId: String(row.profile_id),
      status: String(row.status) as 'pending' | 'ready' | 'empty',
      windowSize: Number(row.window_size),
      sampleSize: Number(row.sample_size),
      ratios: Array.isArray(row.ratios) ? row.ratios : [],
      primaryLanguage: typeof row.primary_language === 'string' ? row.primary_language : null,
      computedAt: row.computed_at ? requireDbIsoString(row.computed_at as Date | string, 'profile_language_profiles.computed_at') : null,
    };
  }

  async upsertPending(client: DbClient, profileId: string): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_language_profiles (profile_id, status, window_size, sample_size, ratios, primary_language, computed_at)
        VALUES ($1::uuid, 'pending', 50, 0, '[]'::jsonb, NULL, NULL)
        ON CONFLICT (profile_id)
        DO UPDATE SET status = 'pending', updated_at = now()
      `,
      [profileId],
    );
  }

  async upsertComputed(client: DbClient, params: {
    profileId: string;
    status: 'ready' | 'empty';
    windowSize: number;
    sampleSize: number;
    ratios: LanguageRatio[];
    primaryLanguage: string | null;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_language_profiles (
          profile_id, status, window_size, sample_size, ratios, primary_language, computed_at
        )
        VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, now())
        ON CONFLICT (profile_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          window_size = EXCLUDED.window_size,
          sample_size = EXCLUDED.sample_size,
          ratios = EXCLUDED.ratios,
          primary_language = EXCLUDED.primary_language,
          computed_at = now(),
          updated_at = now()
      `,
      [
        params.profileId,
        params.status,
        params.windowSize,
        params.sampleSize,
        JSON.stringify(params.ratios),
        params.primaryLanguage,
      ],
    );
  }

  async listRecentWatchedLanguages(client: DbClient, profileId: string, limit: number): Promise<Array<{
    watchId: string;
    watchedAt: string;
    language: string | null;
  }>> {
    const result = await client.query(
      `
        SELECT 
          ptp.title_content_id::text AS watch_id,
          ptp.last_watched_at AS watched_at,
          NULL::text AS language
        FROM profile_title_projection ptp
        WHERE ptp.profile_id = $1::uuid
          AND ptp.effective_watched = true
          AND ptp.last_watched_at IS NOT NULL
        ORDER BY ptp.last_watched_at DESC, ptp.title_content_id DESC
        LIMIT $2
      `,
      [profileId, limit],
    );

    return result.rows.map((row) => ({
      watchId: String(row.watch_id),
      watchedAt: requireDbIsoString(row.watched_at as Date | string, 'profile_title_projection.last_watched_at'),
      language: typeof row.language === 'string' ? row.language : null,
    }));
  }
}
