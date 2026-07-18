import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { withDbClient } from '../../lib/db.js';
import { TemplatesRepository } from '../../modules/homescreen/repos/templates.repo.js';
import { CollectionRegistry } from '../../modules/homescreen/collections/collection-registry.js';
import { TraktImportsRepository } from '../../modules/homescreen/repos/trakt-imports.repo.js';
import { DefaultHomeBuilder } from '../../modules/homescreen/default-home.builder.js';
import { DefaultHomeCacheService } from '../../modules/homescreen/default-home.cache.service.js';
import { HomeResolverService } from '../../modules/homescreen/home-resolver.service.js';
import { HomeModeService } from '../../modules/homescreen/home-mode.service.js';
import { RecommendationOutboxService } from '../../modules/outbox/recommendation-outbox.service.js';
import type { CollectionSource, ProviderRef } from '../../modules/homescreen/homescreen.types.js';
import { isHomeMode } from '../../modules/homescreen/homescreen.types.js';
import { success, mutation } from '../response.js';
import { enqueueHomescreenTraktSync } from '../../lib/queue.js';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${name} is required.`);
  }
  return value.trim();
}

type AdminSession = { username: string };

export async function registerHomescreenAdminRoutes(app: FastifyInstance): Promise<void> {
  const templatesRepository = new TemplatesRepository();
  const collectionRegistry = new CollectionRegistry();
  const traktImportsRepository = new TraktImportsRepository();
  const builder = new DefaultHomeBuilder();
  const cache = new DefaultHomeCacheService();
  const homeResolver = new HomeResolverService();
  const homeModeService = new HomeModeService();
  const recommendationOutboxService = new RecommendationOutboxService();

  const actor = (session: AdminSession): string => session.username;

  // --- Templates ---
  app.get('/admin/api/homescreen/templates', async (request) => {
    const session = await app.requireAdminUi(request);
    const query = asRecord(request.query);
    const locale = typeof query.locale === 'string' ? query.locale : undefined;
    return success({ items: await withDbClient((client) => templatesRepository.list(client, locale)) }, request);
  });

  app.get('/admin/api/homescreen/templates/:locale', async (request) => {
    await app.requireAdminUi(request);
    const params = asRecord(request.params);
    const locale = stringField(params.locale, 'locale');
    const active = await withDbClient((client) => templatesRepository.getActive(client, locale));
    if (!active) {
      throw new HttpError(404, 'No active template for locale.');
    }
    return success({ template: active }, request);
  });

  app.post('/admin/api/homescreen/templates', async (request, reply) => {
    const session = await app.requireAdminUiMutation(request);
    const body = asRecord(request.body);
    const key = stringField(body.key, 'key');
    const locale = stringField(body.locale, 'locale');
    const sectionKeys = Array.isArray(body.sectionKeys) ? body.sectionKeys.map(String) : [];
    if (sectionKeys.length === 0) {
      throw new HttpError(400, 'sectionKeys must be a non-empty array.');
    }
    const template = await withDbClient((client) =>
      templatesRepository.upsert(client, {
        key,
        locale,
        title: typeof body.title === 'string' ? body.title : null,
        sectionKeys,
        isActive: Boolean(body.isActive),
        updatedBy: actor(session),
      }),
    );
    if (template.isActive) {
      await withDbClient((client) => templatesRepository.setActive(client, key, locale, actor(session)));
    }
    reply.code(201);
    return mutation({ template }, request);
  });

  app.put('/admin/api/homescreen/templates/:locale', async (request) => {
    const session = await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const locale = stringField(params.locale, 'locale');
    const body = asRecord(request.body);
    const sectionKeys = Array.isArray(body.sectionKeys) ? body.sectionKeys.map(String) : [];
    if (sectionKeys.length === 0) {
      throw new HttpError(400, 'sectionKeys must be a non-empty array.');
    }
    const existing = await withDbClient((client) => templatesRepository.getByKey(client, stringField(body.key, 'key'), locale));
    if (!existing) {
      throw new HttpError(404, 'Template not found.');
    }
    const template = await withDbClient((client) =>
      templatesRepository.upsert(client, {
        key: existing.key,
        locale,
        title: typeof body.title === 'string' ? body.title : existing.title,
        sectionKeys,
        isActive: Boolean(body.isActive),
        updatedBy: actor(session),
      }),
    );
    if (template.isActive) {
      await withDbClient((client) => templatesRepository.setActive(client, template.key, locale, actor(session)));
    }
    await cache.invalidate(locale);
    return mutation({ template }, request);
  });

  app.delete('/admin/api/homescreen/templates/:key/:locale', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const key = stringField(params.key, 'key');
    const locale = stringField(params.locale, 'locale');
    await withDbClient((client) => templatesRepository.delete(client, key, locale));
    await cache.invalidate(locale);
    return mutation({ accepted: true }, request);
  });

  // --- Collections ---
  app.get('/admin/api/homescreen/collections', async (request) => {
    await app.requireAdminUi(request);
    const query = asRecord(request.query);
    const source = query.source === 'trakt' ? 'trakt' : query.source === 'manual' ? 'manual' : undefined;
    return success({ items: await collectionRegistry.list(source) }, request);
  });

  app.post('/admin/api/homescreen/collections', async (request, reply) => {
    const session = await app.requireAdminUiMutation(request);
    const body = asRecord(request.body);
    const key = stringField(body.key, 'key');
    const providerRefs = parseProviderRefs(body.providerRefs);
    if (providerRefs.length === 0) {
      throw new HttpError(400, 'providerRefs must be a non-empty array.');
    }
    const collection = await collectionRegistry.upsert({
      key,
      title: stringField(body.title, 'title'),
      subtitle: typeof body.subtitle === 'string' ? body.subtitle : null,
      providerRefs,
      source: 'manual',
      updatedBy: actor(session),
    });
    reply.code(201);
    return mutation({ collection }, request);
  });

  app.put('/admin/api/homescreen/collections/:key', async (request) => {
    const session = await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const key = stringField(params.key, 'key');
    const body = asRecord(request.body);
    const existing = await collectionRegistry.get(key);
    if (!existing) {
      throw new HttpError(404, 'Collection not found.');
    }
    const collection = await collectionRegistry.upsert({
      key,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title,
      subtitle: typeof body.subtitle === 'string' ? body.subtitle : existing.subtitle,
      providerRefs: body.providerRefs ? parseProviderRefs(body.providerRefs) : existing.providerRefs,
      source: existing.source,
      sourceRef: existing.sourceRef,
      updatedBy: actor(session),
    });
    return mutation({ collection }, request);
  });

  app.delete('/admin/api/homescreen/collections/:key', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const key = stringField(params.key, 'key');
    await collectionRegistry.remove(key);
    return mutation({ accepted: true }, request);
  });

  // --- Default home (rebuild / preview) ---
  app.post('/admin/api/homescreen/default/regenerate', async (request) => {
    const session = await app.requireAdminUiMutation(request);
    const body = asRecord(request.body);
    const locale = typeof body.locale === 'string' && body.locale.trim() ? body.locale.trim() : 'all';
    const region = typeof body.region === 'string' ? body.region : null;
    const sections = await builder.build(locale, region);
    await cache.storeBuilt(locale, sections, actor(session));
    return mutation({ locale, sectionsBuilt: sections.length }, request);
  });

  app.get('/admin/api/homescreen/default/:locale', async (request) => {
    await app.requireAdminUi(request);
    const params = asRecord(request.params);
    const locale = stringField(params.locale, 'locale');
    const cached = await cache.getBuilt(locale);
    return success({
      locale,
      generatedAt: cached?.generatedAt ?? null,
      sections: cached?.sections ?? [],
    }, request);
  });

  // --- Trakt imports ---
  app.get('/admin/api/homescreen/trakt-imports', async (request) => {
    await app.requireAdminUi(request);
    return success({ items: await withDbClient((client) => traktImportsRepository.list(client)) }, request);
  });

  app.post('/admin/api/homescreen/trakt-imports', async (request, reply) => {
    await app.requireAdminUiMutation(request);
    const body = asRecord(request.body);
    const record = await withDbClient((client) =>
      traktImportsRepository.create(client, {
        slug: stringField(body.slug, 'slug'),
        title: typeof body.title === 'string' ? body.title : null,
        traktListId: typeof body.traktListId === 'string' ? body.traktListId : null,
        templateKey: stringField(body.templateKey, 'templateKey'),
        active: body.active === undefined ? true : Boolean(body.active),
      }),
    );
    reply.code(201);
    return mutation({ import: record }, request);
  });

  app.delete('/admin/api/homescreen/trakt-imports/:id', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const id = stringField(params.id, 'id');
    await withDbClient((client) => traktImportsRepository.delete(client, id));
    return mutation({ accepted: true }, request);
  });

  app.post('/admin/api/homescreen/trakt-imports/:id/sync', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const id = stringField(params.id, 'id');
    const jobId = await enqueueHomescreenTraktSync(id);
    return mutation({ accepted: true, jobId }, request);
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

function parseProviderRefs(value: unknown): ProviderRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): ProviderRef | null => {
      const record = asRecord(item);
      const provider = typeof record.provider === 'string' ? record.provider : null;
      const providerId = typeof record.providerId === 'string' ? record.providerId : null;
      if (!provider || !providerId) {
        return null;
      }
      return {
        provider,
        providerId,
        type: typeof record.type === 'string' ? record.type : undefined,
      };
    })
    .filter((ref): ref is ProviderRef => ref !== null);
}
