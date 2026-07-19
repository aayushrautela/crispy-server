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
import { buildFallbackLists, resolveFallbackTemplatesForViewer, profileContextForFallback, FALLBACK_SECTION_LIMITS, type FallbackTemplate } from './home-fallback.service.js';

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
    const all = await this.repo.listFallbackTemplatesForViewer(locale ? [locale] : []);
    const templates = resolveFallbackTemplatesForViewer(all, locale);
    if (templates.length === 0) return [];

    const connectedProviders = await this.connectedProviderKinds(client, profileId);
    const normalized: Array<{
      listKey: string;
      sectionType: string;
      title: string;
      subtitle: string | null;
      items: unknown[];
    }> = [];

    for (const template of templates as FallbackTemplate[]) {
      // Resolve the effective TMDB language + region for this viewer.
      const tmdbLanguage = template.localeMode === 'en' ? 'en' : (locale || 'en');
      const tmdbRegion = template.regionOverride || region || undefined;
      const viewerLocale = template.localeMode === 'auto' ? (locale || 'en') : (template.localeMode === 'en' ? 'en' : template.locale);

      // Serve from the shared cache when present; otherwise resolve live.
      const cached = await this.repo.getFallbackVersion(template.listKey, viewerLocale, template.sourceId);
      let items: unknown[];
      if (cached && cached.items.length > 0) {
        items = cached.items;
      } else {
        const ctxBase = profileContextForFallback(
          { interfaceLanguage: tmdbLanguage, region: tmdbRegion ?? null, isKids },
          connectedProviders,
        );
        const lists = await buildFallbackLists(
          client,
          this.repo,
          profileId,
          [template],
          { ...ctxBase, tmdbLanguage, tmdbRegion },
          FALLBACK_SECTION_LIMITS,
        );
        const list = lists[0];
        items = list ? list.items : [];
        // Persist to the shared cache so the next viewer in this locale is free.
        if (items.length > 0) {
          await this.repo.saveFallbackVersion({
            listKey: template.listKey,
            locale: viewerLocale,
            sourceId: template.sourceId,
            sectionType: template.sectionType,
            title: template.title,
            subtitle: template.subtitle,
            rank: template.rank,
            items,
          });
        }
      }
      normalized.push({
        listKey: template.listKey,
        sectionType: template.sectionType,
        title: template.title,
        subtitle: template.subtitle ?? null,
        items,
      });
    }

    return this.hydrator.hydrateSections(client, normalized as never, locale);
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
