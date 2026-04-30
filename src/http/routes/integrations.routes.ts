import type { FastifyInstance } from 'fastify';

/**
 * Legacy integration routes are retired.
 *
 * Privileged recommendation applications must use `/internal/apps/v1` and
 * `/internal/confidential/v1`; this module intentionally registers no routes.
 */
export async function registerIntegrationRoutes(_app: FastifyInstance): Promise<void> {
  return;
}
