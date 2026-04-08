import Fastify from 'fastify';
import { loggerOptions } from '../config/logger.js';
import adminUiAuthPlugin from './plugins/admin-ui-auth.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import serviceAuthPlugin from './plugins/service-auth.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerAdminApiRoutes } from './routes/admin-api.js';
import { registerAdminUiRoutes } from './routes/admin-ui.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMeRoutes } from './routes/me.js';
import { registerMetadataRoutes } from './routes/metadata.js';
import { registerInternalAdminImportRoutes } from './routes/internal-admin-imports.js';
import { registerInternalAccountRoutes } from './routes/internal-accounts.js';
import { registerInternalAdminRecommendationRoutes } from './routes/internal-admin-recommendations.js';
import { registerPersonalAccessTokenRoutes } from './routes/personal-access-tokens.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerProfileSettingsRoutes } from './routes/profile-settings.js';
import { registerRecommendationOutputRoutes } from './routes/recommendation-outputs.js';
import { registerWatchRoutes } from './routes/watch.js';
import type { AuthScope, UserAuthActor } from '../modules/auth/auth.types.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth(request: import('fastify').FastifyRequest): Promise<void>;
    requireServiceAuth(request: import('fastify').FastifyRequest): Promise<void>;
    requireUserActor(request: import('fastify').FastifyRequest): UserAuthActor;
    requireScopes(request: import('fastify').FastifyRequest, scopes: AuthScope[]): void;
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
  });

  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await app.register(authPlugin);
  await app.register(serviceAuthPlugin);

  app.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    if (body === '') {
      return done(null, {});
    }
    try {
      const parsed = JSON.parse(body as string);
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await registerHealthRoutes(app);
  await registerAdminUiRoutes(app);
  await registerAdminApiRoutes(app);
  await registerAccountRoutes(app);
  await registerAiRoutes(app);
  await registerMeRoutes(app);
  await registerPersonalAccessTokenRoutes(app);
  await registerProfileRoutes(app);
  await registerProfileSettingsRoutes(app);
  await registerMetadataRoutes(app);
  await registerWatchRoutes(app);
  await registerRecommendationOutputRoutes(app);
  await registerInternalAccountRoutes(app);
  await registerInternalAdminRecommendationRoutes(app);
  await registerInternalAdminImportRoutes(app);
  await registerCalendarRoutes(app);

  return app;
}
