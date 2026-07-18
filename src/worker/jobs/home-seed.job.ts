import { withDbClient, db } from '../../lib/db.js';
import { HomeListsRepo } from '../../modules/home/repos/home-lists.repo.js';
import { DefaultHomeWriteService } from '../../modules/home/home-write.service.js';
import { ContentIdentityService } from '../../modules/identity/content-identity.service.js';
import type { HomeSeedJob } from '../../lib/queue.js';

/**
 * Seeds a profile's `fallback` home from the static templates in
 * `home.fallback_list_templates`. Runs asynchronously after signup so the first
 * home read falls through to reco rows (if any) or the built fallback instead
 * of an empty screen.
 */
export async function runHomeSeedJob(job: HomeSeedJob): Promise<void> {
  const repo = new HomeListsRepo({ db });
  const writeService = new DefaultHomeWriteService({ repo, contentIdentityService: new ContentIdentityService(), clock: { now: () => new Date() } });

  const templates = await withDbClient((client) => repo.listFallbackTemplatesForClient(client));
  if (templates.length === 0) return;

  const grouped = new Map<string, typeof templates>();
  for (const template of templates) {
    const list = grouped.get(template.listKey) ?? [];
    list.push(template);
    grouped.set(template.listKey, list);
  }

  const lists = Array.from(grouped.entries()).map(([listKey, rows]) => {
    const first = rows[0];
    if (!first) return null;
    return {
      listKey,
      sectionType: first.sectionType as 'categoryTabs' | 'heroCarousel' | 'contentRail' | 'collectionRail',
      title: first.title,
      subtitle: first.subtitle,
      items: rows.map((row) => ({
        type: row.mediaType === 'tv' ? ('tv' as const) : ('movie' as const),
        providerRefs: [{ provider: row.provider as 'tmdb' | 'tvdb' | 'imdb' | 'kitsu', providerId: row.providerId }],
        score: row.score,
        reason: row.reason,
        reasonCodes: row.reasonCodes,
      })),
    };
  }).filter((list): list is NonNullable<typeof list> => list !== null);

  await writeService.writeHome({
    accountId: job.accountId,
    profileId: job.profileId,
    source: 'fallback',
    idempotencyKey: `home-seed:${job.accountId}:${job.profileId}`,
    actor: { type: 'app', appId: 'system', keyId: 'system' },
    lists,
  });
}
