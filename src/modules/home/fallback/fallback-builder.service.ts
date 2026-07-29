import { withDbClient, db, type DbClient } from '../../../lib/db.js';
import { ContentIdentityService } from '../../identity/content-identity.service.js';
import { ProfileLocalService } from '../../profiles/profile-local.service.js';
import { getListSource } from '../list-sources/list-source.registry.js';
import type { ListSourceCtx } from '../list-sources/list-source.types.js';
import type { HomeWriteItem, HomeWriteList } from '../home-types.js';
import { HomeListsRepo } from '../repos/home-lists.repo.js';
import { DefaultHomeWriteService, type HomeWriteService } from '../home-write.service.js';
import {
  FALLBACK_SECTION_LIMITS,
  profileContextForFallback,
  resolveFallbackTemplatesForViewer,
  type FallbackTemplate,
} from './fallback-templates.js';

const SYSTEM_ACTOR = { type: 'app' as const, appId: 'system', keyId: 'system' };

type ConnectedProvider = 'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt';

/**
 * Owns the deterministic, in-process fallback home: resolve locale templates
 * for a viewer, fetch from configured list sources, drop empty rails, and
 * persist via the ingester (`HomeWriteService.replaceHomeForSource(fallback)`).
 * Called by the seed job after signup and (in PR3) by the resolver self-heal.
 */
export class FallbackBuilderService {
  private readonly repo: HomeListsRepo;
  private readonly writeService: HomeWriteService;
  private readonly profileService: ProfileLocalService;

  constructor(deps?: {
    repo?: HomeListsRepo;
    writeService?: HomeWriteService;
    profileService?: ProfileLocalService;
  }) {
    this.repo = deps?.repo ?? new HomeListsRepo({ db });
    this.writeService = deps?.writeService ?? new DefaultHomeWriteService({
      repo: new HomeListsRepo({ db }),
      contentIdentityService: new ContentIdentityService(),
      clock: { now: () => new Date() },
    });
    this.profileService = deps?.profileService ?? new ProfileLocalService();
  }

  /**
   * Build and persist fallback home for one profile. Returns metrics on
   * success or `'no-data'` when no templates resolved or all rails were
   * empty (in which case no write is attempted).
   *
   * `idempotencyKey` defaults to the stable seed-job key. Callers that
   * re-seed on demand (e.g. resolver self-heal) must pass a unique key
   * so the ingester doesn't 409 on a hash mismatch with a prior run whose
   * items have since changed.
   */
  async buildForProfile(accountId: string, profileId: string, idempotencyKey: string = `home-seed:${accountId}:${profileId}`): Promise<{ listsWritten: number; itemCount: number } | 'no-data'> {
    const profile = await this.profileService.requireOwnedProfile(accountId, profileId);
    const locale = profile.interfaceLanguage || 'en';

    const all = await this.repo.listFallbackTemplatesForViewer([locale]);
    const templates = resolveFallbackTemplatesForViewer(all as FallbackTemplate[], locale);
    if (templates.length === 0) return 'no-data';

    return withDbClient(async (client) => {
      const connectedProviders = await connectedProviderKinds(client, profileId);
      const ctxBase = profileContextForFallback(profile, connectedProviders);

      const lists = await this.buildLists(client, profileId, templates as FallbackTemplate[], ctxBase);
      if (lists.length === 0) return 'no-data';

      const result = await this.writeService.writeHome({
        accountId,
        profileId,
        source: 'fallback',
        idempotencyKey,
        actor: SYSTEM_ACTOR,
        lists,
      });

      return { listsWritten: result.listsWritten, itemCount: result.itemCount };
    });
  }

  /**
   * Fetch items for each template from its configured list source. Empty rails
   * are dropped (never written). Source-fetch failures are logged and the rail
   * is dropped too — never throws to the caller for individual source failures.
   */
  private async buildLists(
    client: DbClient,
    profileId: string,
    templates: FallbackTemplate[],
    ctxBase: Omit<ListSourceCtx, 'client' | 'profileId' | 'limit'>,
  ): Promise<HomeWriteList[]> {
    const lists: HomeWriteList[] = [];
    for (const template of templates) {
      const source = getListSource(template.sourceId);
      if (!source) continue;
      const limit = FALLBACK_SECTION_LIMITS[template.sectionType] ?? 40;
      const ctx: ListSourceCtx = { client, profileId, ...ctxBase, limit };
      let items: HomeWriteItem[] = [];
      try {
        const result = await source.fetchItems(template.sourceConfig, ctx);
        items = result.items.map((item) => ({
          type: item.type,
          providerRefs: item.providerRefs.map((ref) => ({
            provider: ref.provider as 'tmdb' | 'tvdb' | 'imdb' | 'kitsu',
            providerId: ref.providerId,
          })),
          metadata: item.metadata,
        }));
      } catch (error) {
        console.error(`fallback source ${template.sourceId} failed for ${template.listKey}:`, error);
      }
      if (items.length === 0) continue;
      lists.push({
        sectionType: template.sectionType as HomeWriteList['sectionType'],
        title: template.title,
        subtitle: template.subtitle ?? null,
        items,
      });
    }
    return lists;
  }
}

async function connectedProviderKinds(client: DbClient, profileId: string): Promise<ConnectedProvider[]> {
  try {
    const result = await (client as { query: (t: string, p: unknown[]) => Promise<{ rows: Array<{ provider: string }> }> }).query(
      `SELECT DISTINCT provider FROM user_state.provider_sessions WHERE profile_id = $1::uuid AND state = 'connected'`,
      [profileId],
    );
    return result.rows
      .map((r) => r.provider as ConnectedProvider | 'simkl')
      .filter((p): p is ConnectedProvider => p !== 'simkl');
  } catch {
    return [];
  }
}
