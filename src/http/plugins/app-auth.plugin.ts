import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppAuthService } from '../../modules/apps/app-auth.service.js';
import type { AppRateLimitService } from '../../modules/apps/app-rate-limit.service.js';
import type { AppAuditRepo } from '../../modules/apps/app-audit.repo.js';
import type { AppKeyRecord, AppPrincipal } from '../../modules/apps/app-principal.types.js';
import type { AppRegistryRepo } from '../../modules/apps/app-registry.repo.js';
import type { AppGrantRepo } from '../../modules/apps/app-grant.repo.js';
import type { AppSourceOwnershipRepo } from '../../modules/apps/app-source-ownership.repo.js';
import type { Clock } from '../../modules/apps/clock.js';
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

type EnvVarPrincipalRepoDeps = {
  appRegistryRepo: Pick<AppRegistryRepo, 'findAppById' | 'listScopesForApp' | 'getRateLimitPolicy'>;
  appGrantRepo: Pick<AppGrantRepo, 'listActiveGrantsForApp'>;
  sourceOwnershipRepo: Pick<AppSourceOwnershipRepo, 'findByAppId'>;
};

export interface AppAuthPluginOptions extends EnvVarPrincipalRepoDeps {
  appAuthService: AppAuthService;
  appRateLimitService: AppRateLimitService;
  appAuditRepo: AppAuditRepo;
  clock: Clock;
}

const RECO_ENV_VAR_KEY_ID = '00000000-0000-0000-0000-000000000001';

type BuildPrincipalFromAppIdInput = {
  appId: string;
  keyId: string;
  registryRepo: Pick<AppRegistryRepo, 'findAppById' | 'listScopesForApp' | 'getRateLimitPolicy'>;
  grantRepo: Pick<AppGrantRepo, 'listActiveGrantsForApp'>;
  sourceOwnershipRepo: Pick<AppSourceOwnershipRepo, 'findByAppId'>;
  clock: Clock;
};

async function buildPrincipalFromAppId(input: BuildPrincipalFromAppIdInput): Promise<AppPrincipal> {
  const registryEntry = await input.registryRepo.findAppById(input.appId);
  if (!registryEntry) {
    throw new HttpError(401, `Unknown app_id: ${input.appId}`);
  }
  if (registryEntry.status !== 'active') {
    throw new HttpError(403, `App ${input.appId} is not active.`);
  }

  const now = input.clock.now();
  const [scopes, grants, ownerships, rateLimitPolicy] = await Promise.all([
    input.registryRepo.listScopesForApp(input.appId),
    input.grantRepo.listActiveGrantsForApp(input.appId, now),
    input.sourceOwnershipRepo.findByAppId(input.appId),
    input.registryRepo.getRateLimitPolicy(input.appId),
  ]);

  const fakeKey: AppKeyRecord = {
    keyId: input.keyId,
    appId: input.appId,
    keyHash: '',
    status: 'active',
    createdAt: now,
    expiresAt: null,
    lastUsedAt: null,
    rotationGroup: null,
    allowedIpCidrs: [],
    metadata: { provisioningMethod: 'env-var' },
  };

  return {
    principalType: 'app',
    appId: input.appId,
    keyId: input.keyId,
    scopes,
    grants,
    ownedSources: ownerships.filter((item) => item.status === 'active').map((item) => item.source),
    rateLimitPolicy,
    registryEntry,
  };
}

const appAuthPlugin: FastifyPluginAsync<AppAuthPluginOptions> = async (fastify, options) => {
  const { appAuthService, appAuditRepo, appRegistryRepo, appGrantRepo, sourceOwnershipRepo, clock } = options;

  fastify.decorateRequest('appPrincipal');

  fastify.decorate('requireRecommenderAuth', async (request: FastifyRequest): Promise<AppPrincipal> => {
    if (request.appPrincipal) {
      return request.appPrincipal;
    }

    const header = request.headers.authorization?.trim();
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing recommender bearer token.');
    }

    const token = header.slice('Bearer '.length).trim();
    const expectedHash = env.recommenderToMainServiceTokenHash;
    if (!expectedHash || !token || hashAccessToken(token) !== expectedHash) {
      throw new HttpError(401, 'Invalid recommender bearer token.');
    }

    const principal = await buildPrincipalFromAppId({
      appId: 'reco',
      keyId: RECO_ENV_VAR_KEY_ID,
      registryRepo: appRegistryRepo,
      grantRepo: appGrantRepo,
      sourceOwnershipRepo,
      clock,
    });
    request.appPrincipal = principal;
    request.auth = {
      type: 'recommender',
      appUserId: null,
      serviceId: 'reco',
      scopes: [],
      authSubject: null,
      email: null,
      tokenId: null,
      consumerId: null,
      accessToken: null,
    };
    await appAuditRepo.insert({
      appId: principal.appId,
      keyId: principal.keyId,
      action: 'app_authenticated',
      requestId: request.id,
      metadata: { method: request.method, url: request.url, authPath: 'env-var' },
    }).catch((err) => {
      request.log.warn({ err }, 'Failed to audit app authentication');
    });
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
      if (error instanceof Error && error.constructor.name === 'AppAuthError') {
        await appAuditRepo.insert({
          appId: 'unknown',
          action: 'app_auth_failed',
          requestId: request.id,
          metadata: {
            code: (error as { code?: string }).code ?? 'unknown',
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
