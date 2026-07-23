import type { FastifyInstance } from 'fastify';
import { HttpError } from '../../lib/errors.js';
import { withDbClient, db } from '../../lib/db.js';
import { HomeResolverService } from '../../modules/home/home-resolver.service.js';
import { HomeModeService, isHomeMode } from '../../modules/home/home-mode.service.js';
import { HomeListsRepo } from '../../modules/home/repos/home-lists.repo.js';
import { listSourceDescriptors, getListSource } from '../../modules/home/list-sources/list-source.registry.js';
import { enqueueHomeSeed } from '../../lib/queue.js';
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
    const sectionType = stringField(body.sectionType, 'sectionType');
    if (!SECTION_TYPES.includes(sectionType)) {
      throw new HttpError(400, 'Invalid sectionType.');
    }
    const sourceId = stringField(body.sourceId, 'sourceId');
    const source = getListSource(sourceId);
    if (!source) {
      throw new HttpError(400, `Unknown source: ${sourceId}`);
    }
    const sourceConfig = asRecord(body.sourceConfig);

    // Locale mode drives how this rail resolves per viewer.
    const localeModeRaw = typeof body.localeMode === 'string' ? body.localeMode : 'auto';
    if (!['auto', 'specific', 'en'].includes(localeModeRaw)) {
      throw new HttpError(400, 'Invalid localeMode.');
    }
    const localeMode = localeModeRaw as 'auto' | 'specific' | 'en';
    const overrideLocale = localeMode === 'specific' ? stringField(body.overrideLocale, 'overrideLocale') : 'en';
    const regionOverride = typeof body.regionOverride === 'string' && body.regionOverride ? body.regionOverride : null;

    // Derive the list key server-side when not supplied; de-duplicate on collision.
    const suppliedKey = typeof body.listKey === 'string' && body.listKey.trim() ? body.listKey.trim() : null;
    const baseKey = suppliedKey ?? (typeof source.suggestListKey === 'function' ? source.suggestListKey(sourceConfig) : `${sourceId}-rail`);
    const listKey = await withDbClient((client) => deriveUniqueListKey(repo, baseKey));

    const rank = numberField(body.rank, 'rank', 0);
    const refreshMinutes = body.refreshMinutes === undefined || body.refreshMinutes === null || body.refreshMinutes === ''
      ? null
      : numberField(body.refreshMinutes, 'refreshMinutes', 60);
    await withDbClient((client) => repo.upsertFallbackTemplate({
      listKey,
      locale: overrideLocale,
      localeMode,
      regionOverride,
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
    return mutation({ accepted: true, listKey }, request);
  });

  app.delete('/admin/api/home/fallback-templates/:listKey', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const listKey = stringField(params.listKey, 'listKey');
    await withDbClient((client) => repo.deleteFallbackTemplate(listKey));
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
  // Re-seeds every profile whose active home source is 'fallback'. The seed
  // job will repopulate recommendation_list_versions for this rail across
  // all viewers that currently have it active (bounded by # profiles using
  // fallback). We enqueue via `enqueueHomeSeed`; the worker fans out per
  // profile. Since each seed call uses the same idempotency key for repeat
  // signups (home-seed:<accountId>:<profileId>), a profile whose seed has
  // already completed would short-circuit; that's acceptable -- subsequent
  // refreshes happen via new recompute signals or admin "sync all".
  app.post('/admin/api/home/fallback-templates/:listKey/sync', async (request) => {
    await app.requireAdminUiMutation(request);
    const params = asRecord(request.params);
    const listKey = stringField(params.listKey, 'listKey');
    const template = await withDbClient((client) => repo.listFallbackTemplateByKey(client, listKey));
    if (!template) {
      throw new HttpError(404, 'Fallback template not found.');
    }
    const profiles = await withDbClient((client) => repo.listProfileIdsUsingSource(client, 'fallback', 1000));
    let enqueued = 0;
    for (const { accountId, profileId } of profiles) {
      try {
        await enqueueHomeSeed({ accountId, profileId });
        enqueued++;
      } catch {
        /* per-profile enqueue failures are tolerated; next sync catches them */
      }
    }
    return mutation({ accepted: true, enqueued, profilesTouched: profiles.length }, request);
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

/**
 * Ensure a unique list_key. If the derived base collides with an existing row,
 * append -2, -3, ... until free. Pure server-side; no admin-typed slug needed.
 */
async function deriveUniqueListKey(repo: HomeListsRepo, baseKey: string): Promise<string> {
  const normalized = baseKey.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'rail';
  let candidate = normalized;
  let suffix = 2;
  for (;;) {
    const existing = await withDbClient((client) => repo.listFallbackTemplateByKey(client, candidate));
    if (!existing) return candidate;
    candidate = `${normalized}-${suffix++}`;
  }
}
