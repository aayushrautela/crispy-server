import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withDbClient } from '../../lib/db.js';
import { requireIntegrationAuth } from '../plugins/integration-auth.plugin.js';
import { AccountApiKeyService } from '../../modules/integrations/api-keys/account-api-key.service.js';
import type { AccountApiKeyRecord } from '../../modules/integrations/api-keys/account-api-key.types.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import type { ProfileRecord } from '../../modules/profiles/profile.repo.js';
import { IntegrationHistoryService } from '../../modules/integrations/history/integration-history.service.js';
import { IntegrationOutboxService } from '../../modules/integrations/changes/integration-outbox.service.js';
import { IntegrationAuditService } from '../../modules/integrations/auth/integration-audit.service.js';
import { IntegrationRecommendationError, IntegrationRecommendationService } from '../../modules/integrations/recommendations/integration-recommendation.service.js';
import type { RecommendationListRecord, RecommendationListWithItems } from '../../modules/integrations/recommendations/integration-recommendation.types.js';

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const apiKeyService = new AccountApiKeyService();
  const profileService = new ProfileService();
  const historyService = new IntegrationHistoryService();
  const outboxService = new IntegrationOutboxService();
  const auditService = new IntegrationAuditService();
  const recommendationService = new IntegrationRecommendationService();

  app.post('/api/integrations/v1/api-keys', async (request, reply) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const body = (request.body ?? {}) as Record<string, unknown>;

    const created = await apiKeyService.create({
      accountId: actor.appUserId,
      name: String(body.name ?? '').trim(),
      createdByUserId: actor.appUserId,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    });

    reply.code(201);
    return {
      key: toAccountApiKeySummary(created.key),
      plaintextToken: created.plaintextToken,
    };
  });

  app.get('/api/integrations/v1/api-keys', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);

    const keys = await apiKeyService.list(actor.appUserId);
    return {
      items: keys.map(toAccountApiKeySummary),
    };
  });

  app.delete('/api/integrations/v1/api-keys/:keyId', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { keyId: string };

    const key = await apiKeyService.revoke({
      accountId: actor.appUserId,
      keyId: params.keyId,
      revokedByUserId: actor.appUserId,
    });

    return {
      revoked: true,
      key: toAccountApiKeySummary(key),
    };
  });

  app.post('/api/integrations/v1/api-keys/:keyId/rotate', async (request) => {
    await app.requireAuth(request);
    const actor = app.requireUserActor(request);
    const params = request.params as { keyId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    const rotated = await apiKeyService.rotate({
      accountId: actor.appUserId,
      keyId: params.keyId,
      rotatedByUserId: actor.appUserId,
      name: typeof body.name === 'string' ? body.name : undefined,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
    });

    return {
      key: toAccountApiKeySummary(rotated.key),
      plaintextToken: rotated.plaintextToken,
    };
  });

  app.get('/api/integrations/v1/account', { preHandler: requireIntegrationAuth }, async (request) => {
    const principal = requireIntegrationPrincipal(request);

    return {
      account: {
        id: principal.accountId,
      },
    };
  });

  app.get('/api/integrations/v1/profiles', { preHandler: requireIntegrationAuth }, async (request) => {
    const principal = requireIntegrationPrincipal(request);
    const profiles = await profileService.listForAccount(principal.accountId);

    await withDbClient((client) => auditService.record(client, {
      accountId: principal.accountId,
      apiKeyId: principal.apiKeyId,
      actorType: 'api_key',
      action: 'integration.profiles.list',
      routeMethod: request.method,
      routePath: request.url,
      statusCode: 200,
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { count: profiles.length },
    }));

    return {
      items: profiles.map(toIntegrationProfile),
    };
  });

  app.get('/api/integrations/v1/profiles/:profileId', { preHandler: requireIntegrationAuth }, async (request) => {
    const principal = requireIntegrationPrincipal(request);
    const params = request.params as { profileId: string };
    const profile = await profileService.requireOwnedProfile(principal.accountId, params.profileId);

    await withDbClient((client) => auditService.record(client, {
      accountId: principal.accountId,
      apiKeyId: principal.apiKeyId,
      actorType: 'api_key',
      action: 'integration.profiles.get',
      routeMethod: request.method,
      routePath: request.url,
      statusCode: 200,
      profileId: profile.id,
      resourceType: 'profile',
      resourceId: profile.id,
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    }));

    return {
      profile: toIntegrationProfile(profile),
    };
  });

  app.get('/api/integrations/v1/profiles/:profileId/history', { preHandler: requireIntegrationAuth }, async (request) => {
    const principal = requireIntegrationPrincipal(request);
    const params = request.params as { profileId: string };
    const query = request.query as Record<string, string | undefined>;
    const profile = await profileService.requireOwnedProfile(principal.accountId, params.profileId);
    const limit = parseLimit(query.limit, 100, 500);
    const includeDeleted = query.includeDeleted === 'true';

    const page = await withDbClient(async (client) => historyService.listHistory(client, profile.id, {
      cursor: query.cursor ?? null,
      updatedSince: query.updatedSince ?? null,
      limit,
      includeDeleted,
    }));

    await withDbClient((client) => auditService.record(client, {
      accountId: principal.accountId,
      apiKeyId: principal.apiKeyId,
      actorType: 'api_key',
      action: 'integration.history.list',
      routeMethod: request.method,
      routePath: request.url,
      statusCode: 200,
      profileId: profile.id,
      resourceType: 'profile_history',
      resourceId: profile.id,
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { limit, returned: page.items.length, includeDeleted },
    }));

    return {
      items: page.items,
      pagination: {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    };
  });

  app.put('/api/integrations/v1/profiles/:profileId/recommendation-lists/:listKey', { preHandler: requireIntegrationAuth }, async (request, reply) => {
    const principal = requireIntegrationPrincipal(request);
    const params = request.params as { profileId: string; listKey: string };
    const profile = await profileService.requireOwnedProfile(principal.accountId, params.profileId);
    const idempotencyHeader = request.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;

    try {
      const result = await recommendationService.putList({
        principal,
        profileId: profile.id,
        listKey: params.listKey,
        body: request.body,
        idempotencyKey: typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : null,
      });

      await withDbClient((client) => auditService.record(client, {
        accountId: principal.accountId,
        apiKeyId: principal.apiKeyId,
        actorType: 'api_key',
        action: 'integration.recommendation_lists.write',
        routeMethod: request.method,
        routePath: request.url,
        statusCode: 200,
        profileId: profile.id,
        resourceType: 'recommendation_list',
        resourceId: result.list.id,
        requestId: request.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        metadata: { listKey: params.listKey, itemCount: result.items.length, sourceKey: result.list.sourceKey },
      }));

      return toRecommendationListResponse(result);
    } catch (error) {
      if (error instanceof IntegrationRecommendationError) {
        await withDbClient((client) => auditService.record(client, {
          accountId: principal.accountId,
          apiKeyId: principal.apiKeyId,
          actorType: 'api_key',
          action: 'integration.recommendation_lists.write',
          routeMethod: request.method,
          routePath: request.url,
          statusCode: error.statusCode,
          profileId: profile.id,
          resourceType: 'recommendation_list',
          resourceId: params.listKey,
          requestId: request.id,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          errorCode: 'recommendation_list_write_invalid',
          metadata: { listKey: params.listKey, message: error.message },
        }));
        reply.code(error.statusCode);
        return { error: error.message };
      }
      throw error;
    }
  });

  app.get('/api/integrations/v1/profiles/:profileId/recommendation-lists', { preHandler: requireIntegrationAuth }, async (request) => {
    const principal = requireIntegrationPrincipal(request);
    const params = request.params as { profileId: string };
    const query = request.query as Record<string, string | undefined>;
    const profile = await profileService.requireOwnedProfile(principal.accountId, params.profileId);

    const lists = await recommendationService.listLists({
      principal,
      profileId: profile.id,
      sourceKey: query.sourceKey ?? null,
    });

    await withDbClient((client) => auditService.record(client, {
      accountId: principal.accountId,
      apiKeyId: principal.apiKeyId,
      actorType: 'api_key',
      action: 'integration.recommendation_lists.list',
      routeMethod: request.method,
      routePath: request.url,
      statusCode: 200,
      profileId: profile.id,
      resourceType: 'recommendation_list',
      resourceId: profile.id,
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { returned: lists.length, sourceKey: query.sourceKey ?? null },
    }));

    return { items: lists.map(toRecommendationListSummary) };
  });

  app.get('/api/integrations/v1/profiles/:profileId/recommendation-lists/:listKey', { preHandler: requireIntegrationAuth }, async (request, reply) => {
    const principal = requireIntegrationPrincipal(request);
    const params = request.params as { profileId: string; listKey: string };
    const query = request.query as Record<string, string | undefined>;
    const profile = await profileService.requireOwnedProfile(principal.accountId, params.profileId);

    try {
      const result = await recommendationService.getList({
        principal,
        profileId: profile.id,
        listKey: params.listKey,
        sourceKey: query.sourceKey ?? null,
      });
      if (!result) {
        reply.code(404);
        return { error: 'recommendation list not found' };
      }

      await withDbClient((client) => auditService.record(client, {
        accountId: principal.accountId,
        apiKeyId: principal.apiKeyId,
        actorType: 'api_key',
        action: 'integration.recommendation_lists.get',
        routeMethod: request.method,
        routePath: request.url,
        statusCode: 200,
        profileId: profile.id,
        resourceType: 'recommendation_list',
        resourceId: result.list.id,
        requestId: request.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        metadata: { listKey: params.listKey, itemCount: result.items.length, sourceKey: result.list.sourceKey },
      }));

      return toRecommendationListResponse(result);
    } catch (error) {
      if (error instanceof IntegrationRecommendationError) {
        reply.code(error.statusCode);
        return { error: error.message };
      }
      throw error;
    }
  });

  app.get('/api/integrations/v1/changes', { preHandler: requireIntegrationAuth }, async (request) => {
    const principal = requireIntegrationPrincipal(request);
    const query = request.query as Record<string, string | undefined>;
    const limit = parseLimit(query.limit, 100, 500);

    const page = await withDbClient(async (client) => outboxService.listChanges(client, principal.accountId, {
      cursor: query.cursor ?? null,
      limit,
    }));

    await withDbClient((client) => auditService.record(client, {
      accountId: principal.accountId,
      apiKeyId: principal.apiKeyId,
      actorType: 'api_key',
      action: 'integration.changes.list',
      routeMethod: request.method,
      routePath: request.url,
      statusCode: 200,
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { limit, returned: page.events.length },
    }));

    return {
      items: page.events.map((event) => ({
        id: event.id,
        eventId: event.eventId,
        accountId: event.accountId,
        profileId: event.profileId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventVersion: event.eventVersion,
        occurredAt: event.occurredAt,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
      pagination: {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    };
  });
}

function toAccountApiKeySummary(key: AccountApiKeyRecord) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    status: key.status,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    rotatedFromKeyId: key.rotatedFromKeyId,
  };
}

function toIntegrationProfile(profile: ProfileRecord) {
  return {
    id: profile.id,
    name: profile.name,
    avatarKey: profile.avatarKey,
    isKids: profile.isKids,
    sortOrder: profile.sortOrder,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function toRecommendationListSummary(list: RecommendationListRecord) {
  return {
    id: list.id,
    profileId: list.profileId,
    sourceId: list.sourceId,
    sourceKey: list.sourceKey,
    listKey: list.listKey,
    title: list.title,
    description: list.description,
    algorithmKey: list.algorithmKey,
    modelVersion: list.modelVersion,
    etag: list.etag,
    itemCount: list.itemCount,
    generatedAt: list.generatedAt,
    expiresAt: list.expiresAt,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    metadata: list.metadata,
  };
}

function toRecommendationListResponse(result: RecommendationListWithItems) {
  return {
    list: {
      ...toRecommendationListSummary(result.list),
      items: result.items.map((item) => ({
        id: item.id,
        position: item.position,
        mediaRef: item.rawMediaRef,
        metadataHint: item.metadataHint,
        score: item.score,
        reason: item.reason,
        reasonCode: item.reasonCode,
        resolutionStatus: item.resolutionStatus,
        resolvedContentId: item.resolvedContentId,
        resolvedMediaKey: item.resolvedMediaKey,
        resolvedAt: item.resolvedAt,
        resolutionError: item.resolutionError,
        createdAt: item.createdAt,
      })),
    },
  };
}

function requireIntegrationPrincipal(request: FastifyRequest) {
  const principal = request.integration;
  if (!principal) {
    throw new Error('Integration auth preHandler did not set request.integration');
  }
  return principal;
}

function parseLimit(value: string | undefined, defaultLimit: number, maxLimit: number): number {
  if (!value) {
    return defaultLimit;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    return defaultLimit;
  }
  return Math.min(parsed, maxLimit);
}
