import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/crispy_test';
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  process.env.AUTH_JWKS_URL ||= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.AUTH_JWT_ISSUER ||= 'https://example.supabase.co/auth/v1';
  process.env.AUTH_JWT_AUDIENCE ||= 'authenticated';
  process.env.TMDB_API_KEY ||= 'tmdb-key';
  process.env.SERVICE_CLIENTS_JSON ||= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
  process.env.TRAKT_IMPORT_CLIENT_ID ||= 'trakt-client-id';
  process.env.TRAKT_IMPORT_CLIENT_SECRET ||= 'trakt-client-secret';
  process.env.TRAKT_IMPORT_REDIRECT_URI ||= 'https://api.crispytv.tech/v1/imports/trakt/callback';
}

test('buildAuthUrl uses trakt.tv authorize host', async () => {
  seedTestEnv();
  const { ProviderImportService } = await import('./provider-import.service.js');

  const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const authUrl = (service as any).buildAuthUrl('trakt', 'state-123', 'challenge-abc');

  assert.equal(typeof authUrl, 'string');
  const url = new URL(authUrl);
  assert.equal(url.origin, 'https://trakt.tv');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'trakt-client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.crispytv.tech/v1/imports/trakt/callback');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('exchangeTraktAuthorizationCode includes helpful details for non-json failures', async () => {
  seedTestEnv();
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response('blocked by upstream firewall', {
      status: 403,
      headers: {
        'content-type': 'text/plain',
      },
    });
  }) as typeof fetch;

  try {
    const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await assert.rejects(
      () => (service as any).exchangeTraktAuthorizationCode('code-123', 'verifier-123'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 403);
        assert.equal(error.message, 'Unable to exchange the Trakt authorization code.');
        assert.deepEqual(error.details, {
          provider: 'trakt',
          providerStatus: 403,
          responseBody: 'blocked by upstream firewall',
        });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('traktGetArray includes upstream response details for import failures', async () => {
  seedTestEnv();
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return Response.json({
      error: 'invalid_grant',
      error_description: 'Trakt rejected the current access token.',
    }, {
      status: 401,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof fetch;

  try {
    const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await assert.rejects(
      () => (service as any).traktGetArray('/sync/history', 'access-123'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 401);
        assert.equal(error.message, 'Trakt rejected the current access token.');
        assert.deepEqual(error.details, {
          provider: 'trakt',
          providerStatus: 401,
          requestPath: '/sync/history',
          responseBody: '{"error":"invalid_grant","error_description":"Trakt rejected the current access token."}',
        });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
