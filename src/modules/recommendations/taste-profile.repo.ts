import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';

export type TasteProfileRecord = {
  profileId: string;
  sourceKey: string;
  genres: unknown[];
  preferredActors: unknown[];
  preferredDirectors: unknown[];
  contentTypePref: Record<string, unknown>;
  ratingTendency: Record<string, unknown>;
  decadePreferences: unknown[];
  watchingPace: string | null;
  aiSummary: string | null;
  source: string;
  updatedByKind: string;
  updatedById: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

function mapTasteProfile(row: Record<string, unknown>): TasteProfileRecord {
  return {
    profileId: String(row.profile_id),
    sourceKey: String(row.source_key),
    genres: Array.isArray(row.genres) ? row.genres : [],
    preferredActors: Array.isArray(row.preferred_actors) ? row.preferred_actors : [],
    preferredDirectors: Array.isArray(row.preferred_directors) ? row.preferred_directors : [],
    contentTypePref: isRecord(row.content_type_pref) ? row.content_type_pref : {},
    ratingTendency: isRecord(row.rating_tendency) ? row.rating_tendency : {},
    decadePreferences: Array.isArray(row.decade_preferences) ? row.decade_preferences : [],
    watchingPace: typeof row.watching_pace === 'string' ? row.watching_pace : null,
    aiSummary: typeof row.ai_summary === 'string' ? row.ai_summary : null,
    source: String(row.source),
    updatedByKind: String(row.updated_by_kind),
    updatedById: typeof row.updated_by_id === 'string' ? row.updated_by_id : null,
    version: Number(row.version),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'taste_profiles.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'taste_profiles.updated_at'),
  };
}

export class TasteProfileRepository {
  async findByProfileAndSourceKey(client: DbClient, profileId: string, sourceKey: string): Promise<TasteProfileRecord | null> {
    const result = await client.query(
      `
        SELECT profile_id, source_key, genres, preferred_actors, preferred_directors, content_type_pref,
               rating_tendency, decade_preferences, watching_pace, ai_summary,
               source, updated_by_kind, updated_by_id, version, created_at, updated_at
        FROM taste_profiles
        WHERE profile_id = $1::uuid AND source_key = $2
      `,
      [profileId, sourceKey],
    );

    return result.rows[0] ? mapTasteProfile(result.rows[0]) : null;
  }

  async listForProfile(client: DbClient, profileId: string): Promise<TasteProfileRecord[]> {
    const result = await client.query(
      `
        SELECT profile_id, source_key, genres, preferred_actors, preferred_directors, content_type_pref,
               rating_tendency, decade_preferences, watching_pace, ai_summary,
               source, updated_by_kind, updated_by_id, version, created_at, updated_at
        FROM taste_profiles
        WHERE profile_id = $1::uuid
        ORDER BY updated_at DESC, source_key ASC
      `,
      [profileId],
    );

    return result.rows.map((row) => mapTasteProfile(row));
  }

  async upsert(client: DbClient, params: {
    profileId: string;
    sourceKey: string;
    genres?: unknown[];
    preferredActors?: unknown[];
    preferredDirectors?: unknown[];
    contentTypePref?: Record<string, unknown>;
    ratingTendency?: Record<string, unknown>;
    decadePreferences?: unknown[];
    watchingPace?: string | null;
    aiSummary?: string | null;
    source: string;
    updatedByKind: string;
    updatedById?: string | null;
  }): Promise<TasteProfileRecord> {
    const result = await client.query(
      `
        INSERT INTO taste_profiles (
          profile_id,
          source_key,
          genres,
          preferred_actors,
          preferred_directors,
          content_type_pref,
          rating_tendency,
          decade_preferences,
          watching_pace,
          ai_summary,
          source,
          updated_by_kind,
          updated_by_id
        )
        VALUES (
          $1::uuid,
          $2,
          $3::jsonb,
          $4::jsonb,
          $5::jsonb,
          $6::jsonb,
          $7::jsonb,
          $8::jsonb,
          $9,
          $10,
          $11,
          $12,
          $13
        )
        ON CONFLICT (profile_id, source_key)
        DO UPDATE SET
          genres = EXCLUDED.genres,
          preferred_actors = EXCLUDED.preferred_actors,
          preferred_directors = EXCLUDED.preferred_directors,
          content_type_pref = EXCLUDED.content_type_pref,
          rating_tendency = EXCLUDED.rating_tendency,
          decade_preferences = EXCLUDED.decade_preferences,
          watching_pace = EXCLUDED.watching_pace,
          ai_summary = EXCLUDED.ai_summary,
          source = EXCLUDED.source,
          updated_by_kind = EXCLUDED.updated_by_kind,
          updated_by_id = EXCLUDED.updated_by_id,
          version = taste_profiles.version + 1,
          updated_at = now()
        RETURNING profile_id, source_key, genres, preferred_actors, preferred_directors, content_type_pref,
                  rating_tendency, decade_preferences, watching_pace, ai_summary,
                  source, updated_by_kind, updated_by_id, version, created_at, updated_at
      `,
      [
        params.profileId,
        params.sourceKey,
        JSON.stringify(params.genres ?? []),
        JSON.stringify(params.preferredActors ?? []),
        JSON.stringify(params.preferredDirectors ?? []),
        JSON.stringify(params.contentTypePref ?? {}),
        JSON.stringify(params.ratingTendency ?? {}),
        JSON.stringify(params.decadePreferences ?? []),
        params.watchingPace ?? null,
        params.aiSummary ?? null,
        params.source,
        params.updatedByKind,
        params.updatedById ?? null,
      ],
    );

    return mapTasteProfile(result.rows[0]);
  }

  async deleteForProfile(client: DbClient, profileId: string): Promise<void> {
    await client.query(`DELETE FROM taste_profiles WHERE profile_id = $1::uuid`, [profileId]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
