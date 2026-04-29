import type { DbClient } from '../../lib/db.js';

export interface RecommendationSourceRecord {
  id: string;
  accountId: string;
  sourceKey: string;
  displayName: string;
  sourceType: 'built_in' | 'external';
  apiKeyId: string | null;
}

export class RecommendationSourceRepository {
  async ensureExternalSourceForApiKey(client: DbClient, input: {
    accountId: string;
    apiKeyId: string;
    sourceKey?: string;
    displayName?: string;
  }): Promise<RecommendationSourceRecord> {
    const sourceKey = input.sourceKey ?? `api-key:${input.apiKeyId}`;
    const displayName = input.displayName ?? 'External Integration';

    const result = await client.query(
      `
        INSERT INTO recommendation_sources (
          account_id,
          source_key,
          display_name,
          source_type,
          api_key_id
        )
        VALUES ($1::uuid, $2, $3, 'external', $4::uuid)
        ON CONFLICT (account_id, source_key)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          api_key_id = EXCLUDED.api_key_id,
          status = 'active',
          updated_at = now()
        RETURNING id, account_id, source_key, display_name, source_type, api_key_id
      `,
      [input.accountId, sourceKey, displayName, input.apiKeyId],
    );

    const row = result.rows[0] as Record<string, unknown>;
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      sourceKey: String(row.source_key),
      displayName: String(row.display_name),
      sourceType: String(row.source_type) as 'external',
      apiKeyId: row.api_key_id ? String(row.api_key_id) : null,
    };
  }
}
