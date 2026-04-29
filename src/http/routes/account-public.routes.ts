import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthActor } from '../../modules/auth/auth.types.js';
import { PublicAccountReadService } from '../../modules/account-public/public-account-read.service.js';
import { PublicWatchReadService } from '../../modules/account-public/public-watch-read.service.js';
import { PublicTasteReadService } from '../../modules/account-public/public-taste-read.service.js';
import { PublicRecommendationReadService } from '../../modules/account-public/public-recommendation-read.service.js';
import { LanguageProfileReadService } from '../../modules/language-profile/language-profile-read.service.js';
import { PublicAccountWriteService } from '../../modules/account-public/public-account-write.service.js';

export async function registerAccountPublicRoutes(app: FastifyInstance): Promise<void> {
  const accountReadService = new PublicAccountReadService();
  const watchReadService = new PublicWatchReadService();
  const tasteReadService = new PublicTasteReadService();
  const recommendationReadService = new PublicRecommendationReadService();
  const languageProfileReadService = new LanguageProfileReadService();
  const writeService = new PublicAccountWriteService();

  app.get('/api/account/v1/account', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const account = await accountReadService.getAccount(actor);
    return { account };
  });

  app.get('/api/account/v1/profiles', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const profiles = await accountReadService.listProfiles(actor);
    return { profiles };
  });

  app.get('/api/account/v1/profiles/:profileId', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const profile = await accountReadService.getProfile(actor, params.profileId);
    return { profile };
  });

  app.get('/api/account/v1/profiles/:profileId/recent-watched', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const query = request.query as { limit?: string };

    const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 50);
    const items = await watchReadService.listRecentWatched(actor, params.profileId, limit);

    return { items };
  });

  app.get('/api/account/v1/profiles/:profileId/history', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const query = request.query as { limit?: string; cursor?: string };

    const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 100);
    const result = await watchReadService.listHistory(actor, params.profileId, {
      limit,
      cursor: query.cursor ?? null,
    });

    return result;
  });

  app.get('/api/account/v1/profiles/:profileId/watchlist', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const query = request.query as { limit?: string; cursor?: string };

    const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 100);
    const result = await watchReadService.listWatchlist(actor, params.profileId, {
      limit,
      cursor: query.cursor ?? null,
    });

    return result;
  });

  app.get('/api/account/v1/profiles/:profileId/ratings', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const query = request.query as { limit?: string; cursor?: string };

    const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 100);
    const result = await watchReadService.listRatings(actor, params.profileId, {
      limit,
      cursor: query.cursor ?? null,
    });

    return result;
  });

  app.get('/api/account/v1/profiles/:profileId/continue-watching', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const query = request.query as { limit?: string; cursor?: string };

    const limit = Math.min(parseInt(query.limit ?? '25', 10) || 25, 100);
    const result = await watchReadService.listContinueWatching(actor, params.profileId, {
      limit,
      cursor: query.cursor ?? null,
    });

    return result;
  });

  app.get('/api/account/v1/profiles/:profileId/recommendations/current', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };

    const recommendation = await recommendationReadService.getCurrentForProfile(actor, params.profileId);

    return { recommendation };
  });

  app.get('/api/account/v1/profiles/:profileId/language-profile', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };

    const languageProfile = await languageProfileReadService.getForProfile(actor, params.profileId);

    return { languageProfile };
  });

  app.get('/api/account/v1/profiles/:profileId/taste/current', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };

    const taste = await tasteReadService.getCurrentForProfile(actor, params.profileId);

    return { taste };
  });

  app.put('/api/account/v1/profiles/:profileId/recommendations/:listKey', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string; listKey: string };
    const result = await writeService.replaceRecommendationList({
      actor,
      profileId: params.profileId,
      listKey: params.listKey,
      body: request.body,
      idempotencyKey: getHeader(request, 'idempotency-key'),
      ifMatch: getHeader(request, 'if-match'),
    });
    reply.header('ETag', result.etag).code(result.status);
    return result.response;
  });

  app.delete('/api/account/v1/profiles/:profileId/recommendations/:listKey', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string; listKey: string };
    const result = await writeService.clearRecommendationList({
      actor,
      profileId: params.profileId,
      listKey: params.listKey,
      idempotencyKey: getHeader(request, 'idempotency-key'),
      ifMatch: getHeader(request, 'if-match'),
    });
    reply.code(result.status).send();
  });

  app.put('/api/account/v1/profiles/:profileId/taste/current', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const result = await writeService.replaceTasteProfile({
      actor,
      profileId: params.profileId,
      body: request.body,
      idempotencyKey: getHeader(request, 'idempotency-key'),
      ifMatch: getHeader(request, 'if-match'),
    });
    reply.header('ETag', result.etag).code(result.status);
    return result.response;
  });

  app.delete('/api/account/v1/profiles/:profileId/taste/current', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const result = await writeService.clearTasteProfile({
      actor,
      profileId: params.profileId,
      idempotencyKey: getHeader(request, 'idempotency-key'),
      ifMatch: getHeader(request, 'if-match'),
    });
    reply.code(result.status).send();
  });
}

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}
