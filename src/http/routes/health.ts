import type { FastifyInstance } from 'fastify';
import { success } from '../response.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (request) => success({ ok: true }, request));
}
