import type { DbClient } from '../../lib/db.js';
import type { AiInsightsPayload } from './ai.types.js';

type CachedAiInsightsRecord = {
  payload: AiInsightsPayload;
};

export class AiInsightsCacheRepository {
  async findByKey(client: DbClient, params: {
    contentId: string;
    locale: string;
    generationVersion: string;
  }): Promise<CachedAiInsightsRecord | null> {
    const result = await client.query(
      `
        SELECT payload
        FROM ai_insights_cache
        WHERE content_id = $1::uuid
          AND locale = $2
          AND generation_version = $3
      `,
      [params.contentId, params.locale, params.generationVersion],
    );

    const payload = result.rows[0]?.payload;
    return isAiInsightsPayload(payload) ? { payload } : null;
  }

  async upsert(client: DbClient, params: {
    contentId: string;
    locale: string;
    generationVersion: string;
    modelName: string;
    payload: AiInsightsPayload;
    generatedByProfileId: string;
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
          updated_at
        )
        VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::uuid, now())
        ON CONFLICT (content_id, locale, generation_version)
        DO UPDATE SET
          model_name = EXCLUDED.model_name,
          payload = EXCLUDED.payload,
          generated_by_profile_id = EXCLUDED.generated_by_profile_id,
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
      ],
    );

    const payload = result.rows[0]?.payload;
    return isAiInsightsPayload(payload) ? payload : params.payload;
  }
}

function isAiInsightsPayload(value: unknown): value is AiInsightsPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.insights)) {
    return false;
  }

  return payload.insights.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }

    const card = item as Record<string, unknown>;
    return typeof card.type === 'string'
      && typeof card.title === 'string'
      && typeof card.category === 'string'
      && typeof card.content === 'string';
  }) && typeof payload.trivia === 'string';
}
