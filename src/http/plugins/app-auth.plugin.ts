import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppAuthService } from '../../modules/apps/app-auth.service.js';
import type { AppRateLimitService } from '../../modules/apps/app-rate-limit.service.js';
import type { AppAuditRepo } from '../../modules/apps/app-audit.repo.js';
import type { AppGrant, AppPrincipal, AppScope } from '../../modules/apps/app-principal.types.js';
import { AppAuthError } from '../../modules/apps/app-auth.errors.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { hashAccessToken } from '../../modules/auth/token-hash.js';

declare module 'fastify' {
  interface FastifyRequest {
    appPrincipal?: AppPrincipal;
  }

  interface FastifyInstance {
    requireAppAuth(request: FastifyRequest): Promise<AppPrincipal>;
    requireRecommenderAuth(request: FastifyRequest): Promise<AppPrincipal>;
  }
}

export interface AppAuthPluginOptions {
  appAuthService: AppAuthService;
  appRateLimitService: AppRateLimitService;
  appAuditRepo: AppAuditRepo;
}

const OFFICIAL_RECOMMENDER_SCOPES: AppScope[] = [
  'apps:self:read',
  'profiles:eligible:read',
  'profiles:eligible:snapshot:create',
  'profiles:eligible:snapshot:read',
  'profiles:signals:read',
  'recommendations:service-lists:read',
  'recommendations:service-lists:write',
  'recommendations:service-lists:batch-write',
  'recommendations:runs:write',
  'recommendations:batches:write',
  'recommendations:backfills:read',
  'apps:audit:read',
  'confidential-config:ai-config:read',
];

const OFFICIAL_RECOMMENDER_GRANTS: AppGrant[] = [
  {
    grantId: 'official-recommender-profile-signals',
    appId: 'official-recommender',
    resourceType: 'profileSignals',
    resourceId: '*',
    purpose: 'recommendation-generation',
    actions: ['read'],
    constraints: { eligibleProfilesOnly: false, allowServerFallback: true },
    status: 'active',
    createdAt: new Date(0),
    expiresAt: null,
  },
  {
    grantId: 'official-recommender-ai-config',
    appId: 'official-recommender',
    resourceType: 'aiConfig',
    resourceId: '*',
    purpose: 'recommendation-generation',
    actions: ['read'],
    constraints: { secretDeliveryModes: ['proxy', 'reference'], allowServerFallback: true },
    status: 'active',
    createdAt: new Date(0),
    expiresAt: null,
  },
  {
    grantId: 'official-recommender-recommendation-list',
    appId: 'official-recommender',
    resourceType: 'recommendationList',
    resourceId: '*',
    purpose: 'recommendation-generation',
    actions: ['read', 'write', 'create', 'update'],
    constraints: { source: 'official-recommender', maxItems: 1000 },
    status: 'active',
    createdAt: new Date(0),
    expiresAt: null,
  },
  {
    grantId: 'official-recommender-profile-eligibility',
    appId: 'official-recommender',
    resourceType: 'profileEligibility',
    resourceId: '*',
    purpose: 'recommendation-generation',
    actions: ['read'],
    constraints: {},
    status: 'active',
    createdAt: new Date(0),
    expiresAt: null,
  },
  {
    grantId: 'official-recommender-recommendation-run',
    appId: 'official-recommender',
    resourceType: 'recommendationRun',
    resourceId: '*',
    purpose: 'recommendation-generation',
    actions: ['create', 'update', 'claim'],
    constraints: {},
    status: 'active',
    createdAt: new Date(0),
    expiresAt: null,
  },
  {
    grantId: 'official-recommender-recommendation-batch',
    appId: 'official-recommender',
    resourceType: 'recommendationBatch',
    resourceId: '*',
    purpose: 'recommendation-generation',
    actions: ['create', 'update', 'claim'],
    constraints: {},
    status: 'active',
    createdAt: new Date(0),
    expiresAt: null,
  },
  {
    grantId: 'official-recommender-audit-events',
    appId: 'official-recommender',
    resourceType: 'auditEvents',
    resourceId: '*',
    purpose: 'recommendation-generation',
    actions: ['read'],
    constraints: {},
    status: 'active',
    createdAt: new Date(0),
    expiresAt: null,
  },
];

function buildOfficialRecommenderPrincipal(): AppPrincipal {
  const now = new Date(0);
  return {
    principalType: 'app',
    appId: 'official-recommender',
    keyId: 'crispy-recommender-api-token',
    scopes: OFFICIAL_RECOMMENDER_SCOPES,
    grants: OFFICIAL_RECOMMENDER_GRANTS,
    ownedSources: ['official-recommender', 'recommender', 'crispy'],
    ownedListKeys: ['*'],
    rateLimitPolicy: {
      profileChangesReadsPerMinute: 1000000,
      profileSignalReadsPerMinute: 1000000,
      recommendationWritesPerMinute: 1000000,
      batchWritesPerMinute: 1000000,
      configBundleReadsPerMinute: 1000000,
      runsPerHour: 1000000,
      snapshotsPerDay: 1000000,
      maxProfilesPerBatch: 1000000,
      maxItemsPerList: 1000000,
    },
    registryEntry: {
      appId: 'official-recommender',
      name: 'Official Recommender',
      description: 'Built-in Crispy recommendation engine token principal.',
      status: 'active',
      ownerTeam: 'crispy',
      allowedEnvironments: ['*'],
      principalType: 'service_app',
      createdAt: now,
      updatedAt: now,
      disabledAt: null,
    },
  };
}

const appAuthPlugin: FastifyPluginAsync<AppAuthPluginOptions> = async (fastify, options) => {
  const { appAuthService, appAuditRepo } = options;

  fastify.decorateRequest('appPrincipal');

  fastify.decorate('requireRecommenderAuth', async (request: FastifyRequest): Promise<AppPrincipal> => {
    if (request.appPrincipal?.appId === 'official-recommender') {
      return request.appPrincipal;
    }

    const header = request.headers.authorization?.trim();
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing recommender bearer token.');
    }

    const token = header.slice('Bearer '.length).trim();
    const expectedHash = env.crispyRecommenderApiTokenHash;
    if (!expectedHash || !token || hashAccessToken(token) !== expectedHash) {
      throw new HttpError(401, 'Invalid recommender bearer token.');
    }

    const principal = buildOfficialRecommenderPrincipal();
    request.appPrincipal = principal;
    request.auth = {
      type: 'recommender',
      appUserId: null,
      serviceId: 'official-recommender',
      scopes: ['confidential-config:ai-config:read'],
      authSubject: null,
      email: null,
      tokenId: null,
      consumerId: null,
    };
    return principal;
  });

  fastify.decorate('requireAppAuth', async (request: FastifyRequest): Promise<AppPrincipal> => {
    if (request.appPrincipal) {
      return request.appPrincipal;
    }

    try {
      const principal = await appAuthService.authenticateRequest(request);
      request.appPrincipal = principal;

      await appAuditRepo.insert({
        appId: principal.appId,
        keyId: principal.keyId,
        action: 'app_authenticated',
        requestId: request.id,
        metadata: {
          method: request.method,
          url: request.url,
        },
      }).catch((err) => {
        request.log.warn({ err }, 'Failed to audit app authentication');
      });

      return principal;
    } catch (error) {
      if (error instanceof AppAuthError) {
        await appAuditRepo.insert({
          appId: 'unknown',
          action: 'app_auth_failed',
          requestId: request.id,
          metadata: {
            code: error.code,
            method: request.method,
            url: request.url,
          },
        }).catch((err) => {
          request.log.warn({ err }, 'Failed to audit app auth failure');
        });
      }
      throw error;
    }
  });
};

export default fp(appAuthPlugin, { name: 'app-auth-plugin' });
