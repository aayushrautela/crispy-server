import { withDbClient, db, type DbClient } from '../../lib/db.js';
import { HomeListsRepo } from '../../modules/home/repos/home-lists.repo.js';
import { getListSource } from '../../modules/home/list-sources/list-source.registry.js';
import { buildFallbackLists, FALLBACK_SECTION_LIMITS, type FallbackTemplate } from '../../modules/home/home-fallback.service.js';
import type { HomeFallbackRefreshJob } from '../../lib/queue.js';

/**
 * Refreshes resolved fallback rails into the shared `home.fallback_list_versions`
 * cache so N profiles share a single upstream fetch per refresh interval.
 *
 * scope='cron'  -> refresh every template whose refresh_minutes elapsed.
 * scope='single' -> refresh one template (admin "sync now").
 */
export async function runHomeFallbackRefreshJob(job: HomeFallbackRefreshJob): Promise<void> {
  const repo = new HomeListsRepo({ db });

  if (job.scope === 'single' && job.listKey && job.locale) {
    await refreshOne(repo, job.listKey, job.locale);
    return;
  }

  const threshold = new Date(Date.now() - 60_000);
  const stale = await withDbClient((client) => repo.listStaleFallbackTemplates(threshold));
  for (const template of stale) {
    await refreshOne(repo, template.listKey, template.locale);
  }
}

async function refreshOne(repo: HomeListsRepo, listKey: string, locale: string): Promise<void> {
  await withDbClient(async (client) => {
    const rows = await repo.listFallbackTemplatesForLocales([locale]);
    const template = rows.find((r) => r.listKey === listKey && r.locale === locale);
    if (!template) return;
    const source = getListSource(template.sourceId);
    if (!source) return;

    const lists = await buildFallbackLists(
      client,
      repo,
      '',
      [template as FallbackTemplate],
      { locale, tmdbLanguage: locale, region: null, tmdbRegion: undefined, isKids: false, connectedProviders: [] },
      FALLBACK_SECTION_LIMITS,
    );
    const list = lists[0];
    if (!list) {
      await repo.markFallbackRefreshed(listKey, locale);
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
      listKey: template.listKey,
      locale: template.locale,
      sourceId: template.sourceId,
      sectionType: template.sectionType,
      title: template.title,
      subtitle: template.subtitle,
      rank: template.rank,
      items,
    });
    await repo.markFallbackRefreshed(listKey, locale);
  });
}

export type { DbClient };
