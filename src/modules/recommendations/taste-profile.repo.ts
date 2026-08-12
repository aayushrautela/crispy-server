import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import type { TasteVectors } from './recommendation.types.js';

export type TasteProfileRecord = {
  profileId: string;
  sourceKey: string;
  contentTypePref: Record<string, unknown>;
  ratingTendency: Record<string, unknown>;
  watchingPace: string | null;
  aiSummary: string | null;
  source: string;
  vectors: TasteVectors;
  version: number;
  createdAt: string;
  updatedAt: string;
};

function mapTasteProfile(row: Record<string, unknown>): TasteProfileRecord {
  return {
    profileId: String(row.profile_id),
    sourceKey: String(row.source_key),
    contentTypePref: isRecord(row.content_type_pref) ? row.content_type_pref : {},
    ratingTendency: isRecord(row.rating_tendency) ? row.rating_tendency : {},
    watchingPace: typeof row.watching_pace === 'string' ? row.watching_pace : null,
    aiSummary: typeof row.ai_summary === 'string' ? row.ai_summary : null,
    source: String(row.source),
    vectors: isRecord(row.vectors) && Object.keys(row.vectors).length > 0 ? row.vectors as TasteVectors : { schemaVersion: 3, genres: [], tags: [], people: [], mood: [], decades: [], ratingTiers: [], languages: [] },
    version: Number(row.version),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'taste_profiles.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'taste_profiles.updated_at'),
  };
}

export class TasteProfileRepository {
  async findByProfileAndSourceKey(client: DbClient, profileId: string, sourceKey: string): Promise<TasteProfileRecord | null> {
    const result = await client.query(
      `
        SELECT profile_id, source_key, content_type_pref, rating_tendency,
               watching_pace, ai_summary, source, vectors, version, created_at, updated_at
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
        SELECT profile_id, source_key, content_type_pref, rating_tendency,
               watching_pace, ai_summary, source, vectors, version, created_at, updated_at
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
    contentTypePref?: Record<string, unknown>;
    ratingTendency?: Record<string, unknown>;
    watchingPace?: string | null;
    aiSummary?: string | null;
    source: string;
    vectors?: TasteVectors;
  }): Promise<TasteProfileRecord> {
    const result = await client.query(
      `
        INSERT INTO taste_profiles (
          profile_id,
          source_key,
          content_type_pref,
          rating_tendency,
          watching_pace,
          ai_summary,
          source,
          vectors
        )
        VALUES (
          $1::uuid,
          $2,
          $3::jsonb,
          $4::jsonb,
          $5,
          $6,
          $7,
          $8::jsonb
        )
        ON CONFLICT (profile_id, source_key)
        DO UPDATE SET
          content_type_pref = EXCLUDED.content_type_pref,
          rating_tendency = EXCLUDED.rating_tendency,
          watching_pace = EXCLUDED.watching_pace,
          ai_summary = EXCLUDED.ai_summary,
          source = EXCLUDED.source,
          vectors = EXCLUDED.vectors,
          version = taste_profiles.version + 1,
          updated_at = now()
        RETURNING profile_id, source_key, content_type_pref, rating_tendency,
                  watching_pace, ai_summary, source, vectors, version, created_at, updated_at
      `,
      [
        params.profileId,
        params.sourceKey,
        JSON.stringify(params.contentTypePref ?? {}),
        JSON.stringify(params.ratingTendency ?? {}),
        params.watchingPace ?? null,
        params.aiSummary ?? null,
        params.source,
        JSON.stringify(params.vectors ?? { schemaVersion: 3, genres: [], tags: [], people: [], mood: [], decades: [], ratingTiers: [], languages: [] }),
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
