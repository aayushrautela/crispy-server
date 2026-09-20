import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import type { TasteProfileInput, TasteProfilePayload, TasteVectors } from './recommendation.types.js';

export type TasteProfileRecord = TasteProfilePayload;

const columns = `profile_id, source_key, content_type_pref, watching_pace, ai_summary,
  source, vectors, version, created_at, updated_at, persona_long_term, persona_short_term,
  persona_updated_at, persona_watch_fingerprint, avoidances, drivers`;

function mapTasteProfile(row: Record<string, unknown>): TasteProfileRecord {  return {
    profileId: String(row.profile_id),
    sourceKey: String(row.source_key),
    contentTypePref: isRecord(row.content_type_pref) ? row.content_type_pref : {},
    watchingPace: typeof row.watching_pace === 'string' ? row.watching_pace : null,
    aiSummary: typeof row.ai_summary === 'string' ? row.ai_summary : null,
    source: String(row.source),
    vectors: row.vectors as TasteVectors,
    version: Number(row.version),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'taste_profiles.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'taste_profiles.updated_at'),
    personaLongTerm: typeof row.persona_long_term === 'string' ? row.persona_long_term : null,
    personaShortTerm: typeof row.persona_short_term === 'string' ? row.persona_short_term : null,
    personaUpdatedAt: row.persona_updated_at == null ? null : requireDbIsoString(row.persona_updated_at as Date | string, 'taste_profiles.persona_updated_at'),
    personaWatchFingerprint: typeof row.persona_watch_fingerprint === 'string' ? row.persona_watch_fingerprint : null,
    avoidances: Array.isArray(row.avoidances) ? row.avoidances.filter((value): value is string => typeof value === 'string') : [],
    drivers: Array.isArray(row.drivers) ? row.drivers.filter((value): value is string => typeof value === 'string') : [],
  };
}

export class TasteProfileRepository {
  async findByProfileAndSourceKey(client: DbClient, profileId: string, sourceKey: string): Promise<TasteProfileRecord | null> {
    const result = await client.query(
      `SELECT ${columns} FROM taste_profiles
       WHERE profile_id = $1::uuid AND source_key = $2 AND vectors->>'schemaVersion' = '5'`,
      [profileId, sourceKey],
    );
    return result.rows[0] ? mapTasteProfile(result.rows[0]) : null;
  }

  async listForProfile(client: DbClient, profileId: string): Promise<TasteProfileRecord[]> {
    const result = await client.query(
      `SELECT ${columns} FROM taste_profiles
       WHERE profile_id = $1::uuid AND vectors->>'schemaVersion' = '5'
       ORDER BY updated_at DESC, source_key ASC`,
      [profileId],
    );
    return result.rows.map((row) => mapTasteProfile(row));
  }

  async upsert(client: DbClient, params: TasteProfileInput & { profileId: string }): Promise<TasteProfileRecord> {
    const result = await client.query(
      `
        INSERT INTO taste_profiles (
          profile_id, source_key, content_type_pref, watching_pace, ai_summary, source, vectors,
          persona_long_term, persona_short_term, persona_updated_at, persona_watch_fingerprint, avoidances, drivers
        )
        VALUES ($1::uuid, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9, $10::timestamptz, $11, $12::jsonb, $13::jsonb)
        ON CONFLICT (profile_id, source_key)
        DO UPDATE SET
          content_type_pref = EXCLUDED.content_type_pref,
          watching_pace = EXCLUDED.watching_pace,
          ai_summary = EXCLUDED.ai_summary,
          source = EXCLUDED.source,
          vectors = EXCLUDED.vectors,
          persona_long_term = CASE WHEN $14 THEN EXCLUDED.persona_long_term ELSE taste_profiles.persona_long_term END,
          persona_short_term = CASE WHEN $15 THEN EXCLUDED.persona_short_term ELSE taste_profiles.persona_short_term END,
          persona_updated_at = CASE WHEN $16 THEN EXCLUDED.persona_updated_at ELSE taste_profiles.persona_updated_at END,
          persona_watch_fingerprint = CASE WHEN $17 THEN EXCLUDED.persona_watch_fingerprint ELSE taste_profiles.persona_watch_fingerprint END,
          avoidances = CASE WHEN $18 THEN EXCLUDED.avoidances ELSE taste_profiles.avoidances END,
          drivers = CASE WHEN $19 THEN EXCLUDED.drivers ELSE taste_profiles.drivers END,
          version = taste_profiles.version + 1,
          updated_at = now()
        RETURNING ${columns}
      `,
      [
        params.profileId,
        params.sourceKey,
        JSON.stringify(params.contentTypePref),
        params.watchingPace,
        params.aiSummary,
        params.source,
        JSON.stringify(params.vectors),
        params.personaLongTerm ?? null,
        params.personaShortTerm ?? null,
        params.personaUpdatedAt ?? null,
        params.personaWatchFingerprint ?? null,
        JSON.stringify(params.avoidances ?? []),
        JSON.stringify(params.drivers ?? []),
        params.personaLongTerm !== undefined,
        params.personaShortTerm !== undefined,
        params.personaUpdatedAt !== undefined,
        params.personaWatchFingerprint !== undefined,
        params.avoidances !== undefined,
        params.drivers !== undefined,
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
