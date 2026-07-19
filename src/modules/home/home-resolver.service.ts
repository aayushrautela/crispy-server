import { withDbClient, db, type DbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { HomeModeService } from './home-mode.service.js';
import { HomeListsRepo } from './repos/home-lists.repo.js';
import { HomeHydrator } from './home-hydrator.service.js';
import { DefaultHomeWriteService, type HomeWriteService } from './home-write.service.js';
import type { HomeMode, HomeSource, HomeWriteInput, HomeWriteResult } from './home-types.js';
import type { ClientHomeResponse, ClientHomeSection } from '../recommendations/client-home.types.js';
import { getListSource } from './list-sources/list-source.registry.js';
import { buildFallbackLists, localeCandidates, resolveTemplatesByLocale, profileContextForFallback, FALLBACK_SECTION_LIMITS, type FallbackTemplate } from './home-fallback.service.js';

export type ResolvedHomeSource = 'custom' | 'reco' | 'fallback' | 'fallback-built';

export type ResolveHomeResult = {
  response: ClientHomeResponse;
  mode: HomeMode;
  source: ResolvedHomeSource;
  generatedAt: string;
};

function homeCacheKey(profileId: string): string {
  return `home:${profileId}`;
}

export class HomeResolverService {
  private readonly modeService = new HomeModeService();
  private readonly hydrator = new HomeHydrator();

  constructor(
    private readonly profileLocalService = new ProfileLocalService(),
    private readonly repo = new HomeListsRepo({ db }),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly writeService: HomeWriteService = new DefaultHomeWriteService({ repo: new HomeListsRepo({ db }), contentIdentityService: new ContentIdentityService(), clock: { now: () => new Date() } }),
  ) {}

  async resolveHome(accountId: string, profileId: string): Promise<ResolveHomeResult> {
    const cached = await redis.get(homeCacheKey(profileId));
    if (cached) {
      const parsed = safeParse(cached);
      if (parsed) {
        const mode = await this.modeService.getMode(accountId, profileId);
        return { response: parsed, mode, source: parsed.source, generatedAt: parsed.generatedAt };
      }
    }

    return withDbClient(async (client) => {
      const profile = await this.profileLocalService.requireOwnedProfile(accountId, profileId);
      const mode = await this.modeService.getMode(accountId, profileId);
      const locale = profile.interfaceLanguage || 'en-US';
      const region = profile.region ?? null;

      const source = await this.pickSource(client, accountId, profileId, mode);
      let sections: ClientHomeSection[];
      let resolvedSource: ResolvedHomeSource;

      if (source) {
        const lists = await this.repo.listActiveForSource({ accountId, profileId, source });
        sections = await this.hydrator.hydrateSections(client, lists, locale);
        resolvedSource = source;
      } else {
        sections = await this.hydrateFallbackTemplates(client, accountId, profileId, profile.interfaceLanguage || 'en', region, profile.isKids);
        resolvedSource = 'fallback-built';
      }

      sections = await this.layerContinueWatching(client, sections, profileId, locale);

      const generatedAt = new Date().toISOString();
      const response: ClientHomeResponse & { source: ResolvedHomeSource } = {
        profileId,
        generatedAt,
        expiresAt: null,
        sections,
        source: resolvedSource,
      };
      await redis.set(homeCacheKey(profileId), JSON.stringify(response), 'EX', 30);
      return { response, mode, source: resolvedSource, generatedAt };
    });
  }

  async writeHome(input: HomeWriteInput): Promise<HomeWriteResult> {
    return this.writeService.writeHome(input);
  }

  /** Precedence: custom (custom mode) > reco (else) > fallback. */
  private async pickSource(client: DbClient, accountId: string, profileId: string, mode: HomeMode): Promise<HomeSource | null> {
    const candidates: HomeSource[] = mode === 'custom' ? ['custom', 'reco', 'fallback'] : ['reco', 'fallback'];
    for (const source of candidates) {
      if (await this.repo.hasActiveSourceRows({ accountId, profileId, source })) {
        return source;
      }
    }
    return null;
  }

  /** Layered continue-watching rail, always shown at the top. */
  private async layerContinueWatching(client: DbClient, sections: ClientHomeSection[], profileId: string, locale: string): Promise<ClientHomeSection[]> {
    const source = getListSource('home.continue-watching');
    if (!source) return sections;
    try {
      const result = await source.fetchItems({}, {
        client,
        profileId,
        locale,
        region: null,
        isKids: false,
        connectedProviders: [],
        tmdbLanguage: locale,
        tmdbRegion: undefined,
        limit: 20,
      });
      if (result.items.length === 0) return sections;
      const lists = [{
        listKey: 'continue-watching',
        sectionType: 'contentRail' as const,
        title: 'Continue Watching',
        subtitle: null,
        items: result.items.map((item) => ({
          type: item.type,
          providerRefs: item.providerRefs.map((ref) => ({ provider: ref.provider as 'tmdb' | 'tvdb' | 'imdb' | 'kitsu', providerId: ref.providerId })),
          score: item.score ?? null,
          reason: item.reason ?? null,
          reasonCodes: item.reasonCodes ?? [],
        })),
      }];
      const hydrated = await this.hydrator.hydrateSections(client, lists, locale);
      return [...hydrated, ...sections];
    } catch {
      return sections;
    }
  }

  private async hydrateFallbackTemplates(
    client: DbClient,
    accountId: string,
    profileId: string,
    locale: string,
    region: string | null,
    isKids: boolean,
  ): Promise<ClientHomeSection[]> {
    const candidates = localeCandidates(locale);
    const all = await this.repo.listFallbackTemplatesForLocales(candidates);
    const templates = resolveTemplatesByLocale(all, candidates);
    if (templates.length === 0) return [];

    const connectedProviders = await this.connectedProviderKinds(client, profileId);
    const ctxBase = profileContextForFallback({ interfaceLanguage: locale, region, isKids }, connectedProviders);

    const lists = await buildFallbackLists(
      client,
      this.repo,
      profileId,
      templates as FallbackTemplate[],
      ctxBase,
      FALLBACK_SECTION_LIMITS,
    );
    const normalized = lists.map((list) => ({
      listKey: list.listKey,
      sectionType: list.sectionType,
      title: list.title,
      subtitle: list.subtitle ?? null,
      items: list.items,
    }));
    return this.hydrator.hydrateSections(client, normalized, locale);
  }

  private async connectedProviderKinds(client: DbClient, profileId: string): Promise<Array<'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'>> {
    try {
      const result = await client.query(
        `SELECT DISTINCT provider FROM user_state.provider_sessions WHERE profile_id = $1::uuid AND state = 'connected'`,
        [profileId],
      );
      return (result.rows as Array<{ provider: string }>).map((r) => r.provider as 'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt');
    } catch {
      return [];
    }
  }
}

function safeParse(value: string): (ClientHomeResponse & { source: ResolvedHomeSource }) | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && Array.isArray(parsed.sections)) return parsed as ClientHomeResponse & { source: ResolvedHomeSource };
    return null;
  } catch {
    return null;
  }
}
