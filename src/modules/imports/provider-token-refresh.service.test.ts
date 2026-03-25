import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/crispy_test';
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  process.env.SUPABASE_URL ||= 'https://example.supabase.co';
  process.env.AUTH_JWT_AUDIENCE ||= 'authenticated';
  process.env.TMDB_API_KEY ||= 'tmdb-key';
  process.env.SERVICE_CLIENTS_JSON ||= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
  process.env.TRAKT_IMPORT_CLIENT_ID ||= 'trakt-client-id';
  process.env.TRAKT_IMPORT_CLIENT_SECRET ||= 'trakt-client-secret';
  process.env.TRAKT_IMPORT_REDIRECT_URI ||= 'https://api.crispytv.tech/v1/imports/trakt/callback';
  process.env.SIMKL_IMPORT_CLIENT_ID ||= 'simkl-client-id';
  process.env.SIMKL_IMPORT_CLIENT_SECRET ||= 'simkl-client-secret';
  process.env.SIMKL_IMPORT_REDIRECT_URI ||= 'https://api.crispytv.tech/v1/imports/simkl/callback';
}

test('exchangeTraktRefreshToken surfaces upstream oauth error messages', async () => {
  seedTestEnv();
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return Response.json({
      error: 'invalid_grant',
      error_description: 'Refresh token is invalid or has been revoked.',
    }, {
      status: 401,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof fetch;

  try {
    const service = new ProviderTokenRefreshService({} as never);
    await assert.rejects(
      () => (service as any).exchangeTraktRefreshToken('refresh-123'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 401);
        assert.equal(error.message, 'Refresh token is invalid or has been revoked.');
        assert.deepEqual(error.details, {
          provider: 'trakt',
          providerStatus: 401,
          responseBody: '{"error":"invalid_grant","error_description":"Refresh token is invalid or has been revoked."}',
        });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exchangeSimklRefreshToken includes helpful details for non-json failures', async () => {
  seedTestEnv();
  const { ProviderTokenRefreshService } = await import('./provider-token-refresh.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response('simkl denied refresh', {
      status: 401,
      headers: {
        'content-type': 'text/plain',
      },
    });
  }) as typeof fetch;

  try {
    const service = new ProviderTokenRefreshService({} as never);
    await assert.rejects(
      () => (service as any).exchangeSimklRefreshToken('refresh-123'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 401);
        assert.equal(error.message, 'Unable to refresh the Simkl access token.');
        assert.deepEqual(error.details, {
          provider: 'simkl',
          providerStatus: 401,
          responseBody: 'simkl denied refresh',
        });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
