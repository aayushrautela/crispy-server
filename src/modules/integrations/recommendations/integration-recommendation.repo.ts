import crypto from 'node:crypto';
import type { DbClient } from '../../../lib/db.js';
import { requireDbIsoString, toDbIsoString } from '../../../lib/time.js';
import type { MediaRef, ProviderIds } from '../media-ref.types.js';
import type {
  RecommendationListItemRecord,
  RecommendationListRecord,
  RecommendationListWithItems,
  RecommendationWriteRequestRecord,
  ValidatedRecommendationListWriteInput,
} from './integration-recommendation.types.js';

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function mapList(row: Record<string, unknown>): RecommendationListRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    profileId: String(row.profile_id),
    sourceId: String(row.source_id),
    sourceKey: String(row.source_key),
    listKey: String(row.list_key),
    title: optionalString(row.title),
    description: optionalString(row.description),
    algorithmKey: optionalString(row.algorithm_key),
    modelVersion: optionalString(row.model_version),
    etag: String(row.etag),
    itemCount: Number(row.item_count),
    status: String(row.status) as RecommendationListRecord['status'],
    generatedAt: toDbIsoString(row.generated_at as Date | string | null | undefined, 'profile_recommendation_lists.generated_at'),
    expiresAt: toDbIsoString(row.expires_at as Date | string | null | undefined, 'profile_recommendation_lists.expires_at'),
    replacedAt: toDbIsoString(row.replaced_at as Date | string | null | undefined, 'profile_recommendation_lists.replaced_at'),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'profile_recommendation_lists.created_at'),
    updatedAt: requireDbIsoString(row.updated_at as Date | string | null | undefined, 'profile_recommendation_lists.updated_at'),
    metadata: (row.metadata as Record<string, unknown> | undefined) ?? {},
  };
}

function mapItem(row: Record<string, unknown>): RecommendationListItemRecord {
  return {
    id: String(row.id),
    listId: String(row.list_id),
    accountId: String(row.account_id),
    profileId: String(row.profile_id),
    sourceId: String(row.source_id),
    listKey: String(row.list_key),
    position: Number(row.position),
    mediaType: String(row.media_type) as RecommendationListItemRecord['mediaType'],
    canonicalId: optionalString(row.canonical_id),
    providerIds: (row.provider_ids as ProviderIds | undefined) ?? {},
    seriesRef: (row.series_ref as MediaRef['series'] | null | undefined) ?? null,
    seasonNumber: optionalNumber(row.season_number),
    episodeNumber: optionalNumber(row.episode_number),
    seasonProviderIds: (row.season_provider_ids as ProviderIds | null | undefined) ?? null,
    episodeProviderIds: (row.episode_provider_ids as ProviderIds | null | undefined) ?? null,
    metadataHint: (row.metadata_hint as RecommendationListItemRecord['metadataHint'] | undefined) ?? null,
    rawMediaRef: row.raw_media_ref as MediaRef,
    score: optionalNumber(row.score),
    reason: optionalString(row.reason),
    reasonCode: optionalString(row.reason_code),
    generatedAt: toDbIsoString(row.generated_at as Date | string | null | undefined, 'profile_recommendation_list_items.generated_at'),
    resolutionStatus: String(row.resolution_status) as RecommendationListItemRecord['resolutionStatus'],
    resolvedContentId: optionalString(row.resolved_content_id),
    resolvedMediaKey: optionalString(row.resolved_media_key),
    resolvedAt: toDbIsoString(row.resolved_at as Date | string | null | undefined, 'profile_recommendation_list_items.resolved_at'),
    resolutionError: optionalString(row.resolution_error),
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'profile_recommendation_list_items.created_at'),
  };
}

function mapWriteRequest(row: Record<string, unknown>): RecommendationWriteRequestRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    profileId: String(row.profile_id),
    sourceId: String(row.source_id),
    listKey: String(row.list_key),
    idempotencyKey: String(row.idempotency_key),
    requestHash: String(row.request_hash),
    responseEtag: String(row.response_etag),
    status: String(row.status) as RecommendationWriteRequestRecord['status'],
    createdAt: requireDbIsoString(row.created_at as Date | string | null | undefined, 'recommendation_write_requests.created_at'),
  };
}

export class IntegrationRecommendationRepository {
  async findWriteRequest(client: DbClient, input: {
    sourceId: string;
    profileId: string;
    listKey: string;
    idempotencyKey: string;
  }): Promise<RecommendationWriteRequestRecord | null> {
    const result = await client.query(
      `
        SELECT id, account_id, profile_id, source_id, list_key, idempotency_key, request_hash, response_etag, status, created_at
        FROM recommendation_write_requests
        WHERE source_id = $1::uuid
          AND profile_id = $2::uuid
          AND list_key = $3
          AND idempotency_key = $4
      `,
      [input.sourceId, input.profileId, input.listKey, input.idempotencyKey],
    );
    return result.rows[0] ? mapWriteRequest(result.rows[0] as Record<string, unknown>) : null;
  }

  async replaceList(client: DbClient, input: {
    accountId: string;
    profileId: string;
    sourceId: string;
    sourceKey: string;
    listKey: string;
    payload: ValidatedRecommendationListWriteInput;
    requestHash: string;
    idempotencyKey?: string | null;
  }): Promise<RecommendationListWithItems> {
    const etag = crypto.createHash('sha256').update(`${input.requestHash}:${Date.now()}`).digest('hex');
    const listResult = await client.query(
      `
        INSERT INTO profile_recommendation_lists (
          account_id, profile_id, source_id, list_key, title, description, algorithm_key, model_version,
          etag, item_count, status, generated_at, expires_at, replaced_at, metadata
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, 'active', $11::timestamptz, $12::timestamptz, NULL, $13::jsonb)
        ON CONFLICT (profile_id, source_id, list_key) WHERE status = 'active'
        DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          algorithm_key = EXCLUDED.algorithm_key,
          model_version = EXCLUDED.model_version,
          etag = EXCLUDED.etag,
          item_count = EXCLUDED.item_count,
          generated_at = EXCLUDED.generated_at,
          expires_at = EXCLUDED.expires_at,
          replaced_at = now(),
          updated_at = now(),
          metadata = EXCLUDED.metadata
        RETURNING id, account_id, profile_id, source_id, $14::text AS source_key, list_key, title, description,
          algorithm_key, model_version, etag, item_count, status, generated_at, expires_at, replaced_at,
          created_at, updated_at, metadata
      `,
      [
        input.accountId,
        input.profileId,
        input.sourceId,
        input.listKey,
        input.payload.title,
        input.payload.description,
        input.payload.algorithmKey,
        input.payload.modelVersion,
        etag,
        input.payload.items.length,
        input.payload.generatedAt,
        input.payload.expiresAt,
        JSON.stringify(input.payload.metadata),
        input.sourceKey,
      ],
    );
    const list = mapList(listResult.rows[0] as Record<string, unknown>);

    await client.query('DELETE FROM profile_recommendation_list_items WHERE list_id = $1::uuid', [list.id]);

    for (const item of input.payload.items) {
      await client.query(
        `
          INSERT INTO profile_recommendation_list_items (
            list_id, account_id, profile_id, source_id, list_key, position, media_type, canonical_id,
            provider_ids, series_ref, season_number, episode_number, season_provider_ids, episode_provider_ids,
            metadata_hint, raw_media_ref, score, reason, reason_code, generated_at, resolution_status
          )
          VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8,
            $9::jsonb, $10::jsonb, $11, $12, $13::jsonb, $14::jsonb,
            $15::jsonb, $16::jsonb, $17, $18, $19, $20::timestamptz, 'not_attempted'
          )
        `,
        [
          list.id,
          input.accountId,
          input.profileId,
          input.sourceId,
          input.listKey,
          item.position,
          item.mediaRef.mediaType,
          item.mediaRef.canonicalId ?? null,
          JSON.stringify(item.mediaRef.providerIds ?? {}),
          item.mediaRef.series ? JSON.stringify(item.mediaRef.series) : null,
          item.mediaRef.seasonNumber ?? null,
          item.mediaRef.episodeNumber ?? null,
          item.mediaRef.seasonProviderIds ? JSON.stringify(item.mediaRef.seasonProviderIds) : null,
          item.mediaRef.episodeProviderIds ? JSON.stringify(item.mediaRef.episodeProviderIds) : null,
          item.metadataHint ? JSON.stringify(item.metadataHint) : null,
          JSON.stringify(item.mediaRef),
          item.score,
          item.reason,
          item.reasonCode,
          input.payload.generatedAt,
        ],
      );
    }

    if (input.idempotencyKey) {
      await client.query(
        `
          INSERT INTO recommendation_write_requests (
            account_id, profile_id, source_id, list_key, idempotency_key, request_hash, response_etag, status
          )
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'succeeded')
          ON CONFLICT (source_id, profile_id, list_key, idempotency_key) DO NOTHING
        `,
        [input.accountId, input.profileId, input.sourceId, input.listKey, input.idempotencyKey, input.requestHash, list.etag],
      );
    }

    await this.appendOutboxEvent(client, {
      accountId: input.accountId,
      profileId: input.profileId,
      aggregateId: list.id,
      idempotencyKey: input.idempotencyKey ? `recommendation-list:${input.sourceId}:${input.profileId}:${input.listKey}:${input.idempotencyKey}` : null,
      payload: {
        listId: list.id,
        profileId: input.profileId,
        sourceId: input.sourceId,
        sourceKey: input.sourceKey,
        listKey: input.listKey,
        etag: list.etag,
        itemCount: list.itemCount,
      },
    });

    return this.getList(client, input.accountId, input.profileId, input.sourceId, input.listKey) as Promise<RecommendationListWithItems>;
  }

  async appendOutboxEvent(client: DbClient, input: {
    accountId: string;
    profileId: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string | null;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO integration_outbox_events (
          account_id, profile_id, event_type, aggregate_type, aggregate_id, event_version, payload, idempotency_key
        )
        VALUES ($1::uuid, $2::uuid, 'recommendation_list.upserted', 'recommendation_list', $3, 1, $4::jsonb, $5)
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      `,
      [input.accountId, input.profileId, input.aggregateId, JSON.stringify(input.payload), input.idempotencyKey],
    );
  }

  async listLists(client: DbClient, accountId: string, profileId: string, params: { sourceId?: string | null; sourceKey?: string | null }): Promise<RecommendationListRecord[]> {
    const result = await client.query(
      `
        SELECT l.id, l.account_id, l.profile_id, l.source_id, s.source_key, l.list_key, l.title, l.description,
          l.algorithm_key, l.model_version, l.etag, l.item_count, l.status, l.generated_at, l.expires_at,
          l.replaced_at, l.created_at, l.updated_at, l.metadata
        FROM profile_recommendation_lists l
        JOIN recommendation_sources s ON s.id = l.source_id
        WHERE l.account_id = $1::uuid
          AND l.profile_id = $2::uuid
          AND l.status = 'active'
          AND ($3::uuid IS NULL OR l.source_id = $3::uuid)
          AND ($4::text IS NULL OR s.source_key = $4)
        ORDER BY l.updated_at DESC, l.list_key ASC
      `,
      [accountId, profileId, params.sourceId ?? null, params.sourceKey ?? null],
    );
    return result.rows.map((row) => mapList(row as Record<string, unknown>));
  }

  async getList(client: DbClient, accountId: string, profileId: string, sourceId: string | null, listKey: string): Promise<RecommendationListWithItems | null> {
    const listResult = await client.query(
      `
        SELECT l.id, l.account_id, l.profile_id, l.source_id, s.source_key, l.list_key, l.title, l.description,
          l.algorithm_key, l.model_version, l.etag, l.item_count, l.status, l.generated_at, l.expires_at,
          l.replaced_at, l.created_at, l.updated_at, l.metadata
        FROM profile_recommendation_lists l
        JOIN recommendation_sources s ON s.id = l.source_id
        WHERE l.account_id = $1::uuid
          AND l.profile_id = $2::uuid
          AND l.list_key = $3
          AND l.status = 'active'
          AND ($4::uuid IS NULL OR l.source_id = $4::uuid)
        ORDER BY l.updated_at DESC
        LIMIT 1
      `,
      [accountId, profileId, listKey, sourceId],
    );
    if (!listResult.rows[0]) {
      return null;
    }
    const list = mapList(listResult.rows[0] as Record<string, unknown>);
    const itemsResult = await client.query(
      `
        SELECT id, list_id, account_id, profile_id, source_id, list_key, position, media_type, canonical_id,
          provider_ids, series_ref, season_number, episode_number, season_provider_ids, episode_provider_ids,
          metadata_hint, raw_media_ref, score::float8 AS score, reason, reason_code, generated_at, resolution_status,
          resolved_content_id, resolved_media_key, resolved_at, resolution_error, created_at
        FROM profile_recommendation_list_items
        WHERE list_id = $1::uuid
        ORDER BY position ASC
      `,
      [list.id],
    );
    return { list, items: itemsResult.rows.map((row) => mapItem(row as Record<string, unknown>)) };
  }
}
