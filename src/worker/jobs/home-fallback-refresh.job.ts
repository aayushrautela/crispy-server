import { withDbClient, db, type DbClient } from '../../lib/db.js';
import { HomeListsRepo } from '../../modules/home/repos/home-lists.repo.js';
import { getListSource } from '../../modules/home/list-sources/list-source.registry.js';
import { buildFallbackLists, FALLBACK_SECTION_LIMITS, type FallbackTemplate } from '../../modules/home/home-fallback.service.js';
import type { HomeFallbackRefreshJob } from '../../lib/queue.js';

/**
 * Refreshes resolved fallback rails into the shared `home.fallback_list_versions`
 * cache so N profiles share a single upstream fetch per refresh interval.
 *
 * scope='cron'  -> refresh every 'specific'/'en' template whose refresh_minutes
 *                  elapsed. 'auto' rows are intentionally excluded: they refresh
 *                  lazily per viewer locale on cache miss (see home-resolver).
 * scope='single' -> refresh one template (admin "sync now"). For 'auto' rows the
 *                  locale is resolved from the job payload (viewer locale); the
 *                  cached row is keyed by that locale.
 */
export async function runHomeFallbackRefreshJob(job: HomeFallbackRefreshJob): Promise<void> {
  const repo = new HomeListsRepo({ db });

  if (job.scope === 'single' && job.listKey) {
    await refreshOne(repo, job.listKey, job.locale);
    return;
  }

  const threshold = new Date(Date.now() - 60_000);
  const stale = await withDbClient((client) => repo.listStaleFallbackTemplates(threshold));
  for (const template of stale) {
    await refreshOne(repo, template.listKey, template.locale);
  }
}

async function refreshOne(repo: HomeListsRepo, listKey: string, locale: string | undefined): Promise<void> {
  await withDbClient(async (client) => {
    const rows = await repo.listFallbackTemplateByKey(listKey);
    if (!rows) return;
    const source = getListSource(rows.sourceId);
    if (!source) return;

    // For 'auto' rows the job locale is the viewer locale to refresh; for
    // 'specific'/'en' rows the template's own locale is authoritative.
    const resolvedLocale = rows.localeMode === 'auto' ? (locale ?? 'en') : rows.locale;
    const tmdbLanguage = rows.localeMode === 'en' ? 'en' : resolvedLocale;
    const tmdbRegion = rows.regionOverride ?? undefined;

    const lists = await buildFallbackLists(
      client,
      repo,
      '',
      [rows as FallbackTemplate],
      { locale: tmdbLanguage, tmdbLanguage, region: tmdbRegion ?? null, tmdbRegion, isKids: false, connectedProviders: [] },
      FALLBACK_SECTION_LIMITS,
    );
    const list = lists[0];
    if (!list) {
      await repo.markFallbackRefreshed(listKey);
      return;
    }
    const items = list.items.map((item) => ({
      type: item.type,
      providerRefs: item.providerRefs,
      score: item.score ?? null,
      reason: item.reason ?? null,
      reasonCodes: item.reasonCodes ?? [],
      metadata: item.metadata,
    }));
    await repo.saveFallbackVersion({
      listKey: rows.listKey,
      locale: resolvedLocale,
      sourceId: rows.sourceId,
      sectionType: rows.sectionType,
      title: rows.title,
      subtitle: rows.subtitle,
      rank: rows.rank,
      items,
    });
    await repo.markFallbackRefreshed(listKey);
  });
}

export type { DbClient };
