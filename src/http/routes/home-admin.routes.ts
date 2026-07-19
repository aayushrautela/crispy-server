import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { withDbClient, db } from '../../lib/db.js';
import { HomeResolverService } from '../../modules/home/home-resolver.service.js';
import { HomeModeService, isHomeMode } from '../../modules/home/home-mode.service.js';
import { HomeListsRepo } from '../../modules/home/repos/home-lists.repo.js';
import { listSourceDescriptors, getListSource } from '../../modules/home/list-sources/list-source.registry.js';
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

function numberField(value: unknown, name: string, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `${name} must be a number.`);
  }
  return value;
}

const SECTION_TYPES = ['categoryTabs', 'heroCarousel', 'contentRail', 'collectionRail'];

export async function registerHomeAdminRoutes(app: FastifyInstance): Promise<void> {
  const homeResolver = new HomeResolverService();
  const homeModeService = new HomeModeService();
  const repo = new HomeListsRepo({ db });
  const recommendationOutboxService = new RecommendationOutboxService();

  // --- List source catalog (drives the admin form) ---
  app.get('/admin/api/home/list-sources', async (request) => {
    await app.requireAdminUi(request);
    return success({ items: listSourceDescriptors() }, request);
  });

  // --- Fallback templates ---
  app.get('/admin/api/home/fallback-templates', async (request) => {
    await app.requireAdminUi(request);
    return success({ items: await withDbClient((client) => repo.listFallbackTemplatesForClient(client)) }, request);
  });

  app.post('/admin/api/home/fallback-templates', async (request, reply) => {
    await app.requireAdminUiMutation(request);
    const body = asRecord(request.body);
    const listKey = stringField(body.listKey, 'listKey');
    const locale = stringField(body.locale, 'locale');
    const sectionType = stringField(body.sectionType, 'sectionType');
    if (!SECTION_TYPES.includes(sectionType)) {
      throw new HttpError(400, 'Invalid sectionType.');
    }
    const sourceId = stringField(body.sourceId, 'sourceId');
    if (!getListSource(sourceId)) {
      throw new HttpError(400, `Unknown source: ${sourceId}`);
    }
    const sourceConfig = asRecord(body.sourceConfig);
    const rank = numberField(body.rank, 'rank', 0);
    const refreshMinutes = body.refreshMinutes === undefined || body.refreshMinutes === null || body.refreshMinutes === ''
      ? null
      : numberField(body.refreshMinutes, 'refreshMinutes', 60);
    await withDbClient((client) => repo.upsertFallbackTemplate({
      listKey,
      locale,
      sectionType,
      title: stringField(body.title, 'title'),
      subtitle: typeof body.subtitle === 'string' ? body.subtitle : null,
      rank,
      sourceId,
      sourceConfig,
      refreshMinutes,
      updatedBy: 'admin',
    }));
    reply.code(201);
    return mutation({ accepted: true }, request);
  });

  app.delete('/admin/api/home/fallback-templates/:listKey/:locale', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const listKey = stringField(params.listKey, 'listKey');
    const locale = stringField(params.locale, 'locale');
    await withDbClient((client) => repo.deleteFallbackTemplate(listKey, locale));
    return mutation({ accepted: true }, request);
  });

  // --- Preview a source without persisting ---
  app.post('/admin/api/home/list-sources/preview', async (request) => {
    await app.requireAdminUiMutation(request);
    const body = asRecord(request.body);
    const sourceId = stringField(body.sourceId, 'sourceId');
    const source = getListSource(sourceId);
    if (!source) {
      throw new HttpError(400, `Unknown source: ${sourceId}`);
    }
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';
    const locale = typeof body.locale === 'string' && body.locale ? body.locale : 'en';
    const region = typeof body.region === 'string' && body.region ? body.region : null;
    const limit = numberField(body.limit, 'limit', 20);
    const ctxBase = {
      locale,
      tmdbLanguage: locale,
      region,
      tmdbRegion: region ?? undefined,
      isKids: Boolean(body.isKids),
      connectedProviders: Array.isArray(body.connectedProviders) ? (body.connectedProviders as Array<'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'>) : [],
    };
    const result = await withDbClient((client) =>
      source.fetchItems(asRecord(body.sourceConfig), {
        client,
        profileId,
        ...ctxBase,
        limit,
      }),
    );
    return success({ count: result.items.length, items: result.items.slice(0, limit) }, request);
  });

  // --- Manual refresh/sync of a single fallback rail ---
  app.post('/admin/api/home/fallback-templates/:listKey/:locale/sync', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const listKey = stringField(params.listKey, 'listKey');
    const locale = stringField(params.locale, 'locale');
    await withDbClient(async (client) => {
      const rows = await repo.listFallbackTemplatesForLocales([locale]);
      const template = rows.find((r) => r.listKey === listKey && r.locale === locale);
      if (!template) {
        throw new HttpError(404, 'Fallback template not found.');
      }
      const source = getListSource(template.sourceId);
      if (!source) {
        throw new HttpError(400, `Unknown source: ${template.sourceId}`);
      }
      const connectedProviders = await connectedProviderKindsForLocale(client, locale);
      const ctxBase = profileContextForFallbackPreview(locale, connectedProviders);
      const result = await source.fetchItems(template.sourceConfig, {
        client,
        profileId: '',
        ...ctxBase,
        limit: FALLBACK_PREVIEW_LIMIT,
      });
      const items = result.items.map((item) => ({
        type: item.type,
        providerRefs: item.providerRefs.map((ref) => ({ provider: ref.provider, providerId: ref.providerId })),
        score: item.score ?? null,
        reason: item.reason ?? null,
        reasonCodes: item.reasonCodes ?? [],
      }));
      await repo.saveFallbackVersion({
        listKey: template.listKey,
        locale: template.locale,
        sourceId: template.sourceId,
        sectionType: template.sectionType,
        title: template.title,
        subtitle: template.subtitle,
        rank: template.rank,
        items,
      });
      await repo.markFallbackRefreshed(template.listKey, template.locale);
    });
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

const FALLBACK_PREVIEW_LIMIT = 100;

function profileContextForFallbackPreview(locale: string, connectedProviders: Array<'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'>) {
  return {
    locale,
    tmdbLanguage: locale,
    region: null,
    tmdbRegion: undefined,
    isKids: false,
    connectedProviders,
  };
}

async function connectedProviderKindsForLocale(client: unknown, _locale: string): Promise<Array<'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'>> {
  return [];
}
