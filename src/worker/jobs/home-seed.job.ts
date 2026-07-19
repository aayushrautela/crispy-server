import { withDbClient, db } from '../../lib/db.js';
import { HomeListsRepo } from '../../modules/home/repos/home-lists.repo.js';
import { DefaultHomeWriteService } from '../../modules/home/home-write.service.js';
import { ContentIdentityService } from '../../modules/identity/content-identity.service.js';
import { ProfileLocalService } from '../../modules/profiles/profile-local.service.js';
import { buildFallbackLists, localeCandidates, resolveTemplatesByLocale, profileContextForFallback, FALLBACK_SECTION_LIMITS, type FallbackTemplate } from '../../modules/home/home-fallback.service.js';
import type { HomeSeedJob } from '../../lib/queue.js';

/**
 * Seeds a profile's `fallback` home from source-driven fallback templates.
 * Resolves templates for the profile locale (with fall-through), invokes each
 * configured list source, and writes the resulting lists. Runs asynchronously
 * after signup so the first home read falls through to reco rows (if any) or the
 * built fallback instead of an empty screen.
 */
export async function runHomeSeedJob(job: HomeSeedJob): Promise<void> {
  const repo = new HomeListsRepo({ db });
  const writeService = new DefaultHomeWriteService({ repo, contentIdentityService: new ContentIdentityService(), clock: { now: () => new Date() } });
  const profileService = new ProfileLocalService();

  await withDbClient(async (client) => {
    const profile = await profileService.requireOwnedProfile(job.accountId, job.profileId);
    const candidates = localeCandidates(profile.interfaceLanguage || 'en');
    const all = await repo.listFallbackTemplatesForLocales(candidates);
    const templates = resolveTemplatesByLocale(all, candidates);
    if (templates.length === 0) return;

    const connectedProviders = await connectedProviderKinds(client, job.profileId);
    const ctxBase = profileContextForFallback(profile, connectedProviders);

    const lists = await buildFallbackLists(
      client,
      repo,
      job.profileId,
      templates as FallbackTemplate[],
      ctxBase,
      FALLBACK_SECTION_LIMITS,
    );

    if (lists.length === 0) return;

    await writeService.writeHome({
      accountId: job.accountId,
      profileId: job.profileId,
      source: 'fallback',
      idempotencyKey: `home-seed:${job.accountId}:${job.profileId}`,
      actor: { type: 'app', appId: 'system', keyId: 'system' },
      lists,
    });
  });
}

async function connectedProviderKinds(client: unknown, profileId: string): Promise<Array<'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'>> {
  try {
    const result = await (client as { query: (t: string, p: unknown[]) => Promise<{ rows: Array<{ provider: string }> }> }).query(
      `SELECT DISTINCT provider FROM user_state.provider_sessions WHERE profile_id = $1::uuid AND state = 'connected'`,
      [profileId],
    );
    return result.rows.map((r) => r.provider as 'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt' | 'simkl').filter((p): p is 'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt' => p !== 'simkl');
  } catch {
    return [];
  }
}
