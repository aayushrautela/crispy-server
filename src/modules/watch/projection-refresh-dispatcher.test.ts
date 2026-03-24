import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.AUTH_JWKS_URL ??= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.AUTH_JWT_ISSUER ??= 'https://example.supabase.co/auth/v1';
  process.env.AUTH_JWT_AUDIENCE ??= 'authenticated';
  process.env.TMDB_API_KEY ??= 'tmdb-test-key';
  process.env.SERVICE_CLIENTS_JSON ??= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

async function loadProjectionRefreshDispatcher(): Promise<typeof import('./projection-refresh-dispatcher.js').ProjectionRefreshDispatcher> {
  seedTestEnv();
  const module = await import('./projection-refresh-dispatcher.js');
  return module.ProjectionRefreshDispatcher;
}

test('notifyProfileChanged enqueues home, calendar, and metadata refresh when media key is present', async () => {
  const ProjectionRefreshDispatcher = await loadProjectionRefreshDispatcher();
  const calls: string[] = [];

  const dispatcher = new ProjectionRefreshDispatcher(
    {
      warn: () => {
        throw new Error('warn should not be called');
      },
    } as never,
    {
      enqueueRefreshHomeCache: async (profileId: string) => {
        calls.push(`home:${profileId}`);
      },
      enqueueRefreshCalendarCache: async (profileId: string) => {
        calls.push(`calendar:${profileId}`);
      },
      enqueueMetadataRefresh: async (profileId: string, mediaKey?: string) => {
        calls.push(`metadata:${profileId}:${mediaKey ?? ''}`);
      },
    } as never,
  );

  await dispatcher.notifyProfileChanged('profile-1', {
    mediaKey: 'movie:tmdb:10',
  });

  assert.deepEqual(calls, [
    'home:profile-1',
    'calendar:profile-1',
    'metadata:profile-1:movie:tmdb:10',
  ]);
});

test('notifyProfileChanged skips metadata refresh when disabled', async () => {
  const ProjectionRefreshDispatcher = await loadProjectionRefreshDispatcher();
  const calls: string[] = [];

  const dispatcher = new ProjectionRefreshDispatcher(
    {
      warn: () => {
        throw new Error('warn should not be called');
      },
    } as never,
    {
      enqueueRefreshHomeCache: async (profileId: string) => {
        calls.push(`home:${profileId}`);
      },
      enqueueRefreshCalendarCache: async (profileId: string) => {
        calls.push(`calendar:${profileId}`);
      },
      enqueueMetadataRefresh: async () => {
        calls.push('metadata');
      },
    } as never,
  );

  await dispatcher.notifyProfileChanged('profile-2', {
    mediaKey: 'show:tmdb:12',
    refreshMetadata: false,
  });

  assert.deepEqual(calls, ['home:profile-2', 'calendar:profile-2']);
});

test('notifyProfileChanged swallows queue failures and logs warning', async () => {
  const ProjectionRefreshDispatcher = await loadProjectionRefreshDispatcher();
  const warnings: Array<Record<string, unknown>> = [];

  const dispatcher = new ProjectionRefreshDispatcher(
    {
      warn: (payload: Record<string, unknown>) => {
        warnings.push(payload);
      },
    } as never,
    {
      enqueueRefreshHomeCache: async () => {
        throw new Error('queue offline');
      },
      enqueueRefreshCalendarCache: async () => undefined,
      enqueueMetadataRefresh: async () => undefined,
    } as never,
  );

  await dispatcher.notifyProfileChanged('profile-3', {
    mediaKey: 'episode:tmdb:30:1:2',
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.profileId, 'profile-3');
  assert.equal(warnings[0]?.mediaKey, 'episode:tmdb:30:1:2');
});
