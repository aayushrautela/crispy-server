import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyRequest } from 'fastify';
import { AppAuthError } from '../../modules/apps/app-auth.errors.js';
import type { AppAuthService, AppCredential } from '../../modules/apps/app-auth.service.js';
import type { AppAuditRepo, CreateAppAuditEventInput, AppAuditEventRecord, PaginatedAppAuditEvents } from '../../modules/apps/app-audit.repo.js';
import type { AppPrincipal, AppScope } from '../../modules/apps/app-principal.types.js';
import type { AppRateLimitService, AppRateLimitDecision } from '../../modules/apps/app-rate-limit.service.js';

function buildPrincipal(): AppPrincipal {
  return {
    principalType: 'app',
    appId: 'test-app',
    keyId: 'test-key-id',
    scopes: ['apps:self:read'],
    grants: [],
    ownedSources: ['reco'],
    ownedListKeys: ['for-you'],
    rateLimitPolicy: {
      profileChangesReadsPerMinute: 60,
      profileSignalReadsPerMinute: 60,
      recommendationWritesPerMinute: 60,
      batchWritesPerMinute: 10,
      configBundleReadsPerMinute: 60,
      runsPerHour: 10,
      snapshotsPerDay: 5,
      maxProfilesPerBatch: 100,
      maxItemsPerList: 50,
    },
    registryEntry: {
      appId: 'test-app',
      name: 'Test App',
      status: 'active',
      ownerTeam: 'test',
      allowedEnvironments: ['test'],
      principalType: 'service_app',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    },
  };
}

class FakeAppAuthService implements AppAuthService {
  constructor(private readonly result: AppPrincipal | AppAuthError) {}

  async authenticateRequest(_request: FastifyRequest): Promise<AppPrincipal> {
    if (this.result instanceof AppAuthError) {
      throw this.result;
    }
    return this.result;
  }

  parseAuthorizationHeader(_value?: string): AppCredential {
    return { scheme: 'AppKey', keyId: 'test-key-id', secretOrSignature: 'secret' };
  }

  assertScope(principal: AppPrincipal, requiredScope: AppScope): void {
    if (!principal.scopes.includes(requiredScope)) {
      throw new AppAuthError({ code: 'app_scope_missing', message: 'Missing app scope.', statusCode: 403 });
    }
  }
}

class FakeRateLimitService implements AppRateLimitService {
  async checkAndConsume(): Promise<AppRateLimitDecision> {
    return { allowed: true };
  }
}

class FakeAuditRepo implements AppAuditRepo {
  readonly inserted: CreateAppAuditEventInput[] = [];

  async insert(event: CreateAppAuditEventInput): Promise<AppAuditEventRecord> {
    this.inserted.push(event);
    return {
      eventId: 'event-id',
      appId: event.appId,
      keyId: event.keyId,
      action: event.action,
      accountId: event.accountId,
      profileId: event.profileId,
      runId: event.runId,
      batchId: event.batchId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      requestId: event.requestId,
      metadata: event.metadata,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };
  }

  async listForApp(): Promise<PaginatedAppAuditEvents> {
    return { events: [], cursor: { hasMore: false, next: null } };
  }
}

async function buildApp(authService: AppAuthService, auditRepo = new FakeAuditRepo()) {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('./error-handler.js');
  const { default: appAuthPlugin } = await import('./app-auth.plugin.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(appAuthPlugin, {
    appAuthService: authService,
    appRateLimitService: new FakeRateLimitService(),
    appAuditRepo: auditRepo,
  });

  app.get('/internal/apps/v1/test', async (request) => {
    const principal = await app.requireAppAuth(request);
    return { appId: principal.appId, keyId: principal.keyId, requestPrincipalAppId: request.appPrincipal?.appId };
  });

  return { app, auditRepo };
}

test('app auth plugin decorates request with authenticated app principal', async (t) => {
  const { app, auditRepo } = await buildApp(new FakeAppAuthService(buildPrincipal()));
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/internal/apps/v1/test' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    appId: 'test-app',
    keyId: 'test-key-id',
    requestPrincipalAppId: 'test-app',
  });
  assert.equal(auditRepo.inserted[0]?.action, 'app_authenticated');
});

test('app auth plugin returns app auth error response', async (t) => {
  const authError = new AppAuthError({
    code: 'missing_app_credentials',
    message: 'Missing app credentials.',
    statusCode: 401,
  });
  const { app, auditRepo } = await buildApp(new FakeAppAuthService(authError));
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/internal/apps/v1/test' });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { code: 'missing_app_credentials', message: 'Missing app credentials.' });
  assert.equal(auditRepo.inserted[0]?.action, 'app_auth_failed');
});
