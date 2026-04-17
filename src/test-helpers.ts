import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import type { AuthActor } from './modules/auth/auth.types.js';

const REQUIRED_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  APP_PUBLIC_URL: 'https://api.crispytv.tech',
  APP_DISPLAY_NAME: 'CrispyTV',
  SUPABASE_URL: 'https://example.supabase.co',
  AUTH_JWT_AUDIENCE: 'authenticated',
  TMDB_API_KEY: 'tmdb-test-key',
  TVDB_API_KEY: 'tvdb-test-key',
  TVDB_PIN: '',
  TVDB_BASE_URL: 'https://api4.thetvdb.com/v4',
  KITSU_BASE_URL: 'https://kitsu.io/api/edge',
  SERVICE_CLIENTS_JSON: '[]',
};

export function seedTestEnv(extra?: Record<string, string>): void {
  for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...extra })) {
    process.env[key] ??= value;
  }
}

export function setTestEnv(extra?: Record<string, string>): void {
  for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...extra })) {
    process.env[key] = value;
  }
}

export function clearTestEnv(keys: string[]): void {
  for (const key of keys) {
    delete process.env[key];
  }
}

const TEST_USER_AUTH: {
  type: 'user';
  appUserId: string;
  serviceId: null;
  scopes: never[];
  authSubject: string;
  email: string;
  tokenId: null;
  consumerId: null;
} = {
  type: 'user',
  appUserId: 'user-1',
  serviceId: null,
  scopes: [],
  authSubject: 'auth-subject',
  email: 'test@example.com',
  tokenId: null,
  consumerId: null,
};

export async function buildTestApp(
  register: (app: ReturnType<typeof Fastify>) => Promise<void>,
) {
  seedTestEnv();
  const { default: errorHandlerPlugin } = await import('./http/plugins/error-handler.js');

  const app = Fastify();
  app.decorateRequest('auth');
  app.decorate('requireAuth', async (request: FastifyRequest) => {
    (request as FastifyRequest & { auth: AuthActor }).auth = { ...TEST_USER_AUTH } as AuthActor;
  });
  app.decorate('requireServiceAuth', async () => {});
  app.decorate('requireUserActor', (request: FastifyRequest) => (request as FastifyRequest & { auth: AuthActor }).auth as never);
  app.decorate('requireScopes', () => {});
  await app.register(errorHandlerPlugin);
  await register(app);
  return app;
}

export { TEST_USER_AUTH };

export function createMockMetadataView(overrides: Record<string, unknown> = {}) {
  return {
    mediaType: 'movie',
    kind: 'title',
    provider: 'tmdb',
    providerId: '1',
    parentMediaType: null,
    parentProvider: null,
    parentProviderId: null,
    tmdbId: 1,
    showTmdbId: null,
    seasonNumber: null,
    episodeNumber: null,
    absoluteEpisodeNumber: null,
    title: 'Test Title',
    subtitle: null,
    summary: null,
    overview: null,
    artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
    images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
    releaseDate: null,
    releaseYear: null,
    runtimeMinutes: null,
    rating: null,
    certification: null,
    status: null,
    genres: [],
    externalIds: { tmdb: 1, imdb: 'tt1234567', tvdb: null, kitsu: null },
    seasonCount: null,
    episodeCount: null,
    nextEpisode: null,
    ...overrides,
  };
}

export function createMockResolvePlayback(overrides: Record<string, unknown> = {}) {
  return {
    item: createMockMetadataView(overrides.item as Record<string, unknown> | undefined),
    show: overrides.show ?? null,
    season: overrides.season ?? null,
  };
}

export const NOOP_TRANSACTION = async <T>(work: (client: never) => Promise<T>): Promise<T> =>
  work({} as never);
