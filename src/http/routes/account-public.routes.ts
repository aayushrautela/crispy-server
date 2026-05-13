import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthActor } from '../../modules/auth/auth.types.js';
import { HttpError } from '../../lib/errors.js';
import { PublicAccountReadService } from '../../modules/account-public/public-account-read.service.js';
import { PublicTasteReadService } from '../../modules/account-public/public-taste-read.service.js';
import { LanguageProfileReadService } from '../../modules/language-profile/language-profile-read.service.js';
import { PublicAccountWriteService } from '../../modules/account-public/public-account-write.service.js';
import { success, mutation } from '../response.js';

export interface PublicAccountRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
  remaining?: number;
  resetAt?: Date;
}

export interface PublicAccountRateLimitService {
  checkAndConsume(input: { key: string; method: string }): Promise<PublicAccountRateLimitDecision>;
}

export class InMemoryPublicAccountRateLimitService implements PublicAccountRateLimitService {
  private readonly entries = new Map<string, { count: number; resetAt: Date }>();

  async checkAndConsume(input: { key: string; method: string }): Promise<PublicAccountRateLimitDecision> {
    const now = new Date();
    const limit = getPublicAccountRateLimit(input.method);
    const windowSeconds = 60;
    const bucket = Math.floor(now.getTime() / (windowSeconds * 1000));
    const key = ['public-account-rate-limit', input.key, input.method.toUpperCase(), bucket].join(':');
    const existing = this.entries.get(key);
    const entry = existing && existing.resetAt > now
      ? { count: existing.count + 1, resetAt: existing.resetAt }
      : { count: 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
    this.entries.set(key, entry);

    const remaining = Math.max(limit - entry.count, 0);
    if (entry.count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(Math.ceil((entry.resetAt.getTime() - now.getTime()) / 1000), 1),
        remaining,
        resetAt: entry.resetAt,
      };
    }

    return { allowed: true, remaining, resetAt: entry.resetAt };
  }
}

const defaultRateLimitService = new InMemoryPublicAccountRateLimitService();

export async function registerAccountPublicRoutes(app: FastifyInstance, rateLimitService: PublicAccountRateLimitService = defaultRateLimitService): Promise<void> {
  const accountReadService = new PublicAccountReadService();
  const tasteReadService = new PublicTasteReadService();
  const languageProfileReadService = new LanguageProfileReadService();
  const writeService = new PublicAccountWriteService();

  app.get('/api/account/v1/account', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    await enforcePublicAccountRateLimit(request, reply, rateLimitService);
    const actor = request.auth as AuthActor;
    const account = await accountReadService.getAccount(actor);
    return success({ account }, request);
  });

  app.get('/api/account/v1/profiles', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    await enforcePublicAccountRateLimit(request, reply, rateLimitService);
    const actor = request.auth as AuthActor;
    const profiles = await accountReadService.listProfiles(actor);
    return success({ profiles }, request);
  });

  app.get('/api/account/v1/profiles/:profileId', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    await enforcePublicAccountRateLimit(request, reply, rateLimitService);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };
    const profile = await accountReadService.getProfile(actor, params.profileId);
    return success({ profile }, request);
  });

  app.get('/api/account/v1/profiles/:profileId/language-profile', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    await enforcePublicAccountRateLimit(request, reply, rateLimitService);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };

    const languageProfile = await languageProfileReadService.getForProfile(actor, params.profileId);

    return success({ languageProfile }, request);
  });

  app.get('/api/account/v1/profiles/:profileId/taste/current', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    await enforcePublicAccountRateLimit(request, reply, rateLimitService);
    const actor = request.auth as AuthActor;
    const params = request.params as { profileId: string };

    const taste = await tasteReadService.getCurrentForProfile(actor, params.profileId);

    return success({ taste }, request);
  });

  app.put('/api/account/v1/profiles/:profileId/taste/current', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    await enforcePublicAccountRateLimit(request, reply, rateLimitService);
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
    return mutation(result.response as unknown as Record<string, unknown>, request);
  });

  app.delete('/api/account/v1/profiles/:profileId/taste/current', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.requireAuth(request);
    await enforcePublicAccountRateLimit(request, reply, rateLimitService);
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

async function enforcePublicAccountRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  rateLimitService: PublicAccountRateLimitService,
): Promise<void> {
  const actor = request.auth as AuthActor | undefined;
  if (!actor?.appUserId) {
    throw new HttpError(401, 'Authentication required.');
  }

  const key = actor.type === 'pat' && actor.tokenId ? `pat:${actor.tokenId}` : `user:${actor.appUserId}`;
  const decision = await rateLimitService.checkAndConsume({ key, method: request.method });
  if (!decision.allowed) {
    if (decision.retryAfterSeconds) {
      reply.header('Retry-After', String(decision.retryAfterSeconds));
    }
    if (decision.resetAt) {
      reply.header('X-RateLimit-Reset', decision.resetAt.toISOString());
    }
    if (typeof decision.remaining === 'number') {
      reply.header('X-RateLimit-Remaining', String(decision.remaining));
    }
    throw new HttpError(429, 'Rate limit exceeded.');
  }

  if (actor.type === 'pat') {
    request.log.info({
      method: request.method,
      url: request.url,
      tokenId: actor.tokenId,
      appUserId: actor.appUserId,
    }, 'personal access token used for public account API');
  }
}

function getPublicAccountRateLimit(method: string): number {
  return method.toUpperCase() === 'GET' ? 6 : 2;
}

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}
