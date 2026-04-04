import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  SERVICE_CLIENTS_JSON: JSON.stringify([{
    serviceId: 'test-service',
    apiKey: 'test-key',
    scopes: ['admin:diagnostics:read'],
    status: 'active',
  }]),
});

async function buildInternalApp() {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: serviceAuthPlugin } = await import('../plugins/service-auth.js');
  const { registerInternalAdminRecommendationRoutes } = await import('./internal-admin-recommendations.js');
  const { HttpError } = await import('../../lib/errors.js');

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(serviceAuthPlugin);
  app.decorate('requireScopes', (request, scopes) => {
    const granted = new Set(request.auth?.scopes ?? []);
    for (const scope of scopes) {
      if (!granted.has(scope)) {
        throw new HttpError(403, `Missing required scope: ${scope}`);
      }
    }
  });
  await registerInternalAdminRecommendationRoutes(app);
  return app;
}

test('internal recommendation admin routes require service auth', async (t) => {
  const app = await buildInternalApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/internal/v1/admin/recommendations/generation-jobs/job-123' });
  assert.equal(response.statusCode, 401);
});

test('internal recommendation admin detail route rejects blank job id', async (t) => {
  const app = await buildInternalApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/v1/admin/recommendations/generation-jobs/%20',
    headers: { 'x-service-id': 'test-service', 'x-api-key': 'test-key' },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Missing jobId/);
});

test('internal recommendation admin detail route returns local generation job', async (t) => {
  const { RecommendationAdminService } = await import('../../modules/recommendations/recommendation-admin.service.js');
  const original = RecommendationAdminService.prototype.getGenerationJob;
  RecommendationAdminService.prototype.getGenerationJob = async function (jobId: string) {
    return {
      job: {
        id: jobId,
        status: 'queued',
      } as never,
    };
  };

  t.after(() => {
    RecommendationAdminService.prototype.getGenerationJob = original;
  });

  const app = await buildInternalApp();
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/internal/v1/admin/recommendations/generation-jobs/job-123',
    headers: { 'x-service-id': 'test-service', 'x-api-key': 'test-key' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    job: {
      id: 'job-123',
      status: 'queued',
    },
  });
});
