import type { DbClient } from '../../lib/db.js';
import type { AiInsightsPayload } from './ai.types.js';

type CachedAiInsightsRecord = {
  payload: AiInsightsPayload;
  backdropPaths: string[] | null;
};

export class AiInsightsCacheRepository {
  async findByKey(client: DbClient, params: {
    contentId: string;
    locale: string;
    generationVersion: string;
  }): Promise<CachedAiInsightsRecord | null> {
    const result = await client.query(
      `
        SELECT payload, backdrop_paths
        FROM ai_insights_cache
        WHERE content_id = $1::uuid
          AND locale = $2
          AND generation_version = $3
      `,
      [params.contentId, params.locale, params.generationVersion],
    );

    const row = result.rows[0];
    const payload = row?.payload;
    return isAiInsightsPayload(payload) ? { payload, backdropPaths: readBackdropPaths(row?.backdrop_paths) } : null;
  }

  async upsert(client: DbClient, params: {
    contentId: string;
    locale: string;
    generationVersion: string;
    modelName: string;
    payload: AiInsightsPayload;
    generatedByProfileId: string;
    backdropPaths: string[];
  }): Promise<AiInsightsPayload> {
    const result = await client.query(
      `
        INSERT INTO ai_insights_cache (
          content_id,
          locale,
          generation_version,
          model_name,
          payload,
          generated_by_profile_id,
          backdrop_paths,
          updated_at
        )
        VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::uuid, $7::text[], now())
        ON CONFLICT (content_id, locale, generation_version)
        DO UPDATE SET
          model_name = EXCLUDED.model_name,
          payload = EXCLUDED.payload,
          generated_by_profile_id = EXCLUDED.generated_by_profile_id,
          backdrop_paths = EXCLUDED.backdrop_paths,
          updated_at = now()
        RETURNING payload
      `,
      [
        params.contentId,
        params.locale,
        params.generationVersion,
        params.modelName,
        JSON.stringify(params.payload),
        params.generatedByProfileId,
        params.backdropPaths,
      ],
    );

    const payload = result.rows[0]?.payload;
    return isAiInsightsPayload(payload) ? payload : params.payload;
  }

  async updateBackdropPaths(client: DbClient, params: {
    contentId: string;
    locale: string;
    generationVersion: string;
    backdropPaths: string[];
  }): Promise<void> {
    await client.query(
      `
        UPDATE ai_insights_cache
        SET backdrop_paths = $4::text[], updated_at = now()
        WHERE content_id = $1::uuid
          AND locale = $2
          AND generation_version = $3
      `,
      [params.contentId, params.locale, params.generationVersion, params.backdropPaths],
    );
  }
}

function readBackdropPaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function isAiInsightsPayload(value: unknown): value is AiInsightsPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const goodStuff = isInsightSection(payload.the_good_stuff);
  const theCatch = isInsightSection(payload.the_catch);
  // At least one of positive/negative must carry real feedback.
  if (!goodStuff && !theCatch) {
    return false;
  }

  return isInsightSection(payload.standout_element) && isInsightSection(payload.trivia);
}

function isInsightSection(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const section = value as Record<string, unknown>;
  if (typeof section.text !== 'string' || !section.text.trim()) {
    return false;
  }
  if (section.heading !== null && section.heading !== undefined && typeof section.heading !== 'string') {
    return false;
  }
  return true;
}
