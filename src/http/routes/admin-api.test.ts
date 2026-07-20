import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyRequest } from 'fastify';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  AI_SERVER_API_KEY: 'sk-test-server-key',
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  ADMIN_UI_SESSION_SECRET: 'admin-session-secret-for-tests',
});

test('admin AI test accepts arbitrary non-empty custom model ids', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');
  const { getServerAiProvider } = await import('../../config/app-config.js');
  const configuredModels = Object.values(getServerAiProvider().models)
    .flatMap((modelsByFeature) => Object.values(modelsByFeature));
  const slashlessModel = configuredModels.find((model) => !model.includes('/')) ?? 'model-without-slash';

  const app = Fastify();
  const adminSession = {
    username: 'admin-user',
    csrfToken: 'csrf-token',
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  app.decorate('requireAdminUiMutation', async (_request: FastifyRequest) => adminSession);
  app.decorate('requireAdminUi', async (_request: FastifyRequest) => adminSession);
  await app.register(errorHandlerPlugin);
  await registerAdminApiRoutes(app);

  const originalFetch = globalThis.fetch;
  const requestedModels: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: unknown };
    requestedModels.push(String(body.model ?? ''));
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ ok: true, model: body.model }) } }],
    });
  }) as typeof fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/api/ai/test',
    payload: {
      prompt: 'Return JSON.',
      targets: [{ mode: 'server', model: slashlessModel }],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(requestedModels, [slashlessModel]);

  const payload = JSON.parse(response.body) as {
    data: { summary: { success: number; error: number }; results: Array<{ status: string; model: string; result?: { model?: string } }> };
  };
  assert.deepEqual(payload.data.summary, { total: 1, success: 1, error: 0 });
  assert.equal(payload.data.results[0]?.status, 'success');
  assert.equal(payload.data.results[0]?.model, slashlessModel);
  assert.equal(payload.data.results[0]?.result?.model, slashlessModel);
});

test('admin AI test returns upstream model format failures as provider errors', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');

  const app = Fastify();
  const adminSession = {
    username: 'admin-user',
    csrfToken: 'csrf-token',
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  app.decorate('requireAdminUiMutation', async (_request: FastifyRequest) => adminSession);
  app.decorate('requireAdminUi', async (_request: FastifyRequest) => adminSession);
  await app.register(errorHandlerPlugin);
  await registerAdminApiRoutes(app);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({
    error: {
      message: 'model should be in provider/model format',
      code: 'invalid_model',
      param: 'model',
    },
  }, { status: 400 })) as typeof fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/api/ai/test',
    payload: {
      prompt: 'Return JSON.',
      targets: [{ mode: 'server', model: 'slashless-model' }],
    },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    data: {
      summary: { success: number; error: number };
      results: Array<{
        status: string;
        error?: string;
        providerError?: { providerStatus?: number; responseBody?: string; providerErrorCode?: string; providerErrorParam?: string };
        logs?: string[];
      }>;
    };
  };

  assert.deepEqual(payload.data.summary, { total: 1, success: 0, error: 1 });
  assert.equal(payload.data.results[0]?.status, 'error');
  assert.equal(payload.data.results[0]?.error, 'Provider rejected this model: model should be in provider/model format');
  assert.equal(payload.data.results[0]?.providerError?.providerStatus, 400);
  assert.equal(payload.data.results[0]?.providerError?.providerErrorCode, 'invalid_model');
  assert.equal(payload.data.results[0]?.providerError?.providerErrorParam, 'model');
  assert.match(payload.data.results[0]?.providerError?.responseBody ?? '', /model should be in provider\/model format/);
  assert.ok(payload.data.results[0]?.logs?.some((line) => line.includes('Provider error returned by upstream AI provider')));
});

test('admin AI test rejects empty custom model ids only', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');

  const app = Fastify();
  const adminSession = {
    username: 'admin-user',
    csrfToken: 'csrf-token',
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  app.decorate('requireAdminUiMutation', async (_request: FastifyRequest) => adminSession);
  app.decorate('requireAdminUi', async (_request: FastifyRequest) => adminSession);
  await app.register(errorHandlerPlugin);
  await registerAdminApiRoutes(app);

  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'POST',
    url: '/admin/api/ai/test',
    payload: {
      prompt: 'Return JSON.',
      targets: [{ mode: 'server', model: '   ' }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /target\.model is required/);
});

test('admin recompute multiple profiles validates max 50', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');

  const app = Fastify();
  const adminSession = {
    username: 'admin-user',
    csrfToken: 'csrf-token',
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  app.decorate('requireAdminUiMutation', async (_request: FastifyRequest) => adminSession);
  app.decorate('requireAdminUi', async (_request: FastifyRequest) => adminSession);
  await app.register(errorHandlerPlugin);
  await registerAdminApiRoutes(app);

  t.after(async () => { await app.close(); });

  const profileIds = Array.from({ length: 51 }, (_, i) => `profile-${i}`);
  const response = await app.inject({
    method: 'POST',
    url: '/admin/api/accounts/account-1/recommendations/notify-recompute',
    payload: { profileIds },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Maximum 50 profiles/);
});

