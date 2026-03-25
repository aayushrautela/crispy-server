import type { FastifyInstance } from 'fastify';
import { renderAdminPage } from '../admin-ui/page.js';

export async function registerAdminUiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin', async (request, reply) => {
    await app.requireAdminUi(request, reply);
    reply.header('cache-control', 'no-store');
    reply.type('text/html; charset=utf-8');
    return renderAdminPage();
  });
}
