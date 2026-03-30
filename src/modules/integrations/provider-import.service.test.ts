import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv({ TRAKT_IMPORT_CLIENT_ID: 'trakt-client-id', TRAKT_IMPORT_CLIENT_SECRET: 'trakt-client-secret', TRAKT_IMPORT_REDIRECT_URI: 'https://api.crispytv.tech/v1/imports/trakt/callback' });

test('buildAuthUrl uses trakt.tv authorize host', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const authUrl = (service as any).buildAuthUrl('trakt', 'state-123', 'challenge-abc');

  const url = new URL(authUrl);
  assert.equal(url.origin, 'https://trakt.tv');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'trakt-client-id');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('exchangeTraktAuthorizationCode includes details for non-json failures', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('blocked', { status: 403, headers: { 'content-type': 'text/plain' } })) as typeof fetch;

  try {
    const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await assert.rejects(
      () => (service as any).exchangeTraktAuthorizationCode('code-123', 'verifier-123'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 403);
        assert.equal(error.message, 'Unable to exchange the Trakt authorization code.');
        assert.deepEqual(error.details, { provider: 'trakt', providerStatus: 403, responseBody: 'blocked' });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('traktGetArray includes upstream response details for import failures', async () => {
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { HttpError } = await import('../../lib/errors.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: 'invalid_grant' }, { status: 401 })) as typeof fetch;

  try {
    const service = new ProviderImportService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await assert.rejects(
      () => (service as any).traktGetArray('/sync/history', 'access-123'),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 401);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
