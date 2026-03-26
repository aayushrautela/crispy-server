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

test('disconnectConnection falls back to revoking without credential rewrite if sanitizing payload fails at the database layer', async () => {
  seedTestEnv();
  const { ProviderImportService } = await import('./provider-import.service.js');
  const { db } = await import('../../lib/db.js');

  const profileRepository = {
    async findByIdForOwnerUser() {
      return {
        id: 'profile-1',
        profileGroupId: 'group-1',
        name: 'Main',
      };
    },
  };

  const connectedRecord = {
    id: 'connection-1',
    profileId: 'profile-1',
    provider: 'trakt',
    status: 'connected',
    stateToken: null,
    providerUserId: 'provider-user-1',
    externalUsername: 'crispy',
    credentialsJson: {
      lastImportJobId: 'job-1',
      lastImportCompletedAt: 'Wed Aug 09 2023 16:57:00 GMT+0000 (Coordinated Universal Time)',
      lastRefreshAt: 'Thu Aug 10 2023 12:00:00 GMT+0000 (Coordinated Universal Time)',
      accessToken: 'secret',
      refreshToken: 'refresh-secret',
    },
    createdByUserId: 'user-1',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: '2026-03-25T00:00:00.000Z',
    updatedAt: '2026-03-26T00:00:00.000Z',
  };

  const revokedRecord = {
    ...connectedRecord,
    status: 'revoked',
    credentialsJson: connectedRecord.credentialsJson,
    lastUsedAt: '2026-03-26T12:00:00.000Z',
    updatedAt: '2026-03-26T12:00:00.000Z',
  };

  const revokeCalls: Array<{ connectionId: string; lastUsedAt?: string | null; credentialsJson?: Record<string, unknown> }> = [];
  const connectionsRepository = {
    async findLatestConnectedForProfile() {
      return connectedRecord;
    },
    async revokeConnection(_client: unknown, params: { connectionId: string; lastUsedAt?: string | null; credentialsJson?: Record<string, unknown> }) {
      revokeCalls.push(params);
      if (revokeCalls.length === 1) {
        throw new Error('invalid input syntax for type timestamp with time zone');
      }
      return revokedRecord;
    },
  };

  const service = new ProviderImportService(
    profileRepository as never,
    connectionsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const originalConnect = db.connect.bind(db);
  (db as { connect: typeof db.connect }).connect = async () => ({
    async query() {
      return { rows: [], rowCount: 0 } as never;
    },
    release() {
    },
  } as never);

  try {
    const result = await service.disconnectConnection('user-1', 'profile-1', 'trakt');

    assert.equal(revokeCalls.length, 2);
    assert.equal(revokeCalls[0]?.connectionId, 'connection-1');
    assert.equal(revokeCalls[1]?.connectionId, 'connection-1');
    assert.equal('credentialsJson' in revokeCalls[1], false);
    assert.equal(result.connection.status, 'revoked');
    assert.equal(result.connection.provider, 'trakt');
  } finally {
    (db as { connect: typeof db.connect }).connect = originalConnect;
  }
});
