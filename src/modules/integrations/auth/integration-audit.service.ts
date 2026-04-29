import type { DbClient } from '../../../lib/db.js';

export type IntegrationAuditActorType = 'user' | 'api_key' | 'system';

export interface RecordIntegrationAuditInput {
  accountId: string;
  apiKeyId?: string | null;
  actorType: IntegrationAuditActorType;
  action: string;
  routeMethod?: string | null;
  routePath?: string | null;
  statusCode?: number | null;
  profileId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
}

export class IntegrationAuditService {
  async record(client: DbClient, input: RecordIntegrationAuditInput): Promise<void> {
    await client.query(
      `
        INSERT INTO integration_audit_log (
          account_id,
          api_key_id,
          actor_type,
          action,
          route_method,
          route_path,
          status_code,
          profile_id,
          resource_type,
          resource_id,
          request_id,
          ip_address,
          user_agent,
          error_code,
          metadata
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::uuid,
          $9,
          $10,
          $11,
          $12::inet,
          $13,
          $14,
          $15::jsonb
        )
      `,
      [
        input.accountId,
        input.apiKeyId ?? null,
        input.actorType,
        input.action,
        input.routeMethod ?? null,
        input.routePath ?? null,
        input.statusCode ?? null,
        input.profileId ?? null,
        input.resourceType ?? null,
        input.resourceId ?? null,
        input.requestId ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.errorCode ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}
