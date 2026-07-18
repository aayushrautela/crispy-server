import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { withDbClient, db } from '../../lib/db.js';
import { HomeResolverService } from '../../modules/home/home-resolver.service.js';
import { HomeModeService, isHomeMode } from '../../modules/home/home-mode.service.js';
import { HomeListsRepo } from '../../modules/home/repos/home-lists.repo.js';
import { RecommendationOutboxService } from '../../modules/outbox/recommendation-outbox.service.js';
import { success, mutation } from '../response.js';

type AdminSession = { username: string };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${name} is required.`);
  }
  return value.trim();
}

export async function registerHomeAdminRoutes(app: FastifyInstance): Promise<void> {
  const homeResolver = new HomeResolverService();
  const homeModeService = new HomeModeService();
  const repo = new HomeListsRepo({ db });
  const recommendationOutboxService = new RecommendationOutboxService();

  // --- Fallback templates ---
  app.get('/admin/api/home/fallback-templates', async (request) => {
    await app.requireAdminUi(request);
    return success({ items: await withDbClient((client) => repo.listFallbackTemplatesForClient(client)) }, request);
  });

  app.post('/admin/api/home/fallback-templates', async (request, reply) => {
    await app.requireAdminUiMutation(request);
    const body = asRecord(request.body);
    const listKey = stringField(body.listKey, 'listKey');
    const sectionType = stringField(body.sectionType, 'sectionType');
    if (sectionType !== 'categoryTabs' && sectionType !== 'heroCarousel' && sectionType !== 'contentRail' && sectionType !== 'collectionRail') {
      throw new HttpError(400, 'Invalid sectionType.');
    }
    const provider = stringField(body.provider, 'provider');
    if (provider !== 'tmdb' && provider !== 'tvdb' && provider !== 'imdb' && provider !== 'kitsu') {
      throw new HttpError(400, 'Invalid provider.');
    }
    const providerId = stringField(body.providerId, 'providerId');
    const mediaType = stringField(body.mediaType, 'mediaType');
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      throw new HttpError(400, 'mediaType must be movie or tv.');
    }
    const rank = typeof body.rank === 'number' ? body.rank : 0;
    await withDbClient((client) => client.query(
      `INSERT INTO home.fallback_list_templates (list_key, section_type, title, subtitle, rank, provider, provider_id, media_type, score, reason, reason_codes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[])
       ON CONFLICT (list_key, rank) DO UPDATE SET section_type = EXCLUDED.section_type, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, provider = EXCLUDED.provider, provider_id = EXCLUDED.provider_id, media_type = EXCLUDED.media_type, score = EXCLUDED.score, reason = EXCLUDED.reason, reason_codes = EXCLUDED.reason_codes`,
      [listKey, sectionType, stringField(body.title, 'title'), typeof body.subtitle === 'string' ? body.subtitle : null, rank, provider, providerId, mediaType, typeof body.score === 'number' ? body.score : null, typeof body.reason === 'string' ? body.reason : null, Array.isArray(body.reasonCodes) ? body.reasonCodes.map(String) : []],
    ));
    reply.code(201);
    return mutation({ accepted: true }, request);
  });

  app.delete('/admin/api/home/fallback-templates/:listKey/:rank', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const listKey = stringField(params.listKey, 'listKey');
    const rank = Number(params.rank);
    if (!Number.isInteger(rank)) throw new HttpError(400, 'rank must be an integer.');
    await withDbClient((client) => client.query('DELETE FROM home.fallback_list_templates WHERE list_key = $1 AND rank = $2', [listKey, rank]));
    return mutation({ accepted: true }, request);
  });

  // --- Per-profile home mode + recompute ---
  app.get('/admin/api/accounts/:accountId/profiles/:profileId/home', async (request) => {
    await app.requireAdminUi(request);
    const params = asRecord(request.params);
    const accountId = stringField(params.accountId, 'accountId');
    const profileId = stringField(params.profileId, 'profileId');
    const resolved = await homeResolver.resolveHome(accountId, profileId);
    return success({
      profileId,
      mode: resolved.mode,
      source: resolved.source,
      generatedAt: resolved.generatedAt,
      sections: resolved.response.sections,
    }, request);
  });

  app.put('/admin/api/accounts/:accountId/profiles/:profileId/home-mode', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const accountId = stringField(params.accountId, 'accountId');
    const profileId = stringField(params.profileId, 'profileId');
    const body = asRecord(request.body);
    const mode = stringField(body.mode, 'mode');
    if (!isHomeMode(mode)) {
      throw new HttpError(400, 'Invalid homeMode.');
    }
    const updated = await homeModeService.setMode(accountId, profileId, mode);
    return mutation({ mode: updated }, request);
  });

  app.post('/admin/api/accounts/:accountId/profiles/:profileId/recompute', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const accountId = stringField(params.accountId, 'accountId');
    const profileId = stringField(params.profileId, 'profileId');
    await withDbClient((client) =>
      recommendationOutboxService.appendRecomputeRequested(client, {
        userId: accountId,
        profileId,
        reason: 'admin_requested',
      }),
    );
    return mutation({ accepted: true }, request);
  });
}
