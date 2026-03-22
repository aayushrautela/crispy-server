import Fastify from 'fastify';
import { loggerOptions } from '../config/logger.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import profileContextPlugin from './plugins/profile-context.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerHomeRoutes } from './routes/home.js';
import { registerMeRoutes } from './routes/me.js';
import { registerMetadataRoutes } from './routes/metadata.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerProfileSettingsRoutes } from './routes/profile-settings.js';
import { registerWatchRoutes } from './routes/watch.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth(request: import('fastify').FastifyRequest): Promise<void>;
    requireProfileId(request: import('fastify').FastifyRequest): string;
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
  });

  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(profileContextPlugin);

  await registerHealthRoutes(app);
  await registerMeRoutes(app);
  await registerProfileRoutes(app);
  await registerProfileSettingsRoutes(app);
  await registerMetadataRoutes(app);
  await registerWatchRoutes(app);
  await registerHomeRoutes(app);
  await registerCalendarRoutes(app);

  return app;
}
