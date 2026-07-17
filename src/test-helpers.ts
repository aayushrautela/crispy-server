import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import type { AuthActor } from './modules/auth/auth.types.js';

const emptyImageSet = () => ({ small: null, medium: null, large: null });

const REQUIRED_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  APP_PUBLIC_URL: 'https://api.crispytv.tech',
  APP_DISPLAY_NAME: 'CrispyTV',
  AUTH_BASE_URL: 'https://example.supabase.co',
  AUTH_JWKS_URL: 'https://example.supabase.co/.well-known/jwks.json',
  AUTH_JWT_AUDIENCE: 'authenticated',
  AUTH_JWT_SECRET: 'test-auth-jwt-secret-thats-long-enough-32-chars',
  AUTH_ADMIN_API_KEY: 'test-admin-api-key',
  TMDB_API_KEY: 'tmdb-test-key',
  SECRETS_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  CURSOR_SIGNING_SECRET: 'test-cursor-signing-secret-thats-long-enough-32',
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
  accessToken: string;
} = {
  type: 'user',
  appUserId: 'user-1',
  serviceId: null,
  scopes: [],
  authSubject: 'auth-subject',
  email: 'test@example.com',
  tokenId: null,
  consumerId: null,
  accessToken: 'test-supabase-jwt-token',
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
  app.decorate('requireUserActor', (request: FastifyRequest) => (request as FastifyRequest & { auth: AuthActor }).auth as never);
  app.decorate('requireUserSessionActor', (request: FastifyRequest) => (request as FastifyRequest & { auth: AuthActor }).auth as never);
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
    artwork: { poster: emptyImageSet(), backdrop: emptyImageSet(), still: emptyImageSet() },
    images: { poster: emptyImageSet(), backdrop: emptyImageSet(), still: emptyImageSet(), logo: emptyImageSet() },
    releaseDate: null,
    releaseYear: null,
    runtimeMinutes: null,
    rating: null,
    maturityRating: null,
    certification: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    status: null,
    genres: [],
    externalIds: { tmdb: 1, imdb: 'tt1234567', tvdb: null },
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
  work({ query: async () => ({ rows: [], rowCount: 0 }) } as never);
