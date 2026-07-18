import { withDbClient, db, type DbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { HomeModeService } from './home-mode.service.js';
import { HomeListsRepo } from './repos/home-lists.repo.js';
import { HomeHydrator } from './home-hydrator.service.js';
import { DefaultHomeWriteService, type HomeWriteService } from './home-write.service.js';
import { ContinueWatchingProvider } from './providers/continue-watching.provider.js';
import type { HomeMode, HomeSource, HomeWriteInput, HomeWriteResult } from './home-types.js';
import type { ClientHomeResponse, ClientHomeSection } from '../recommendations/client-home.types.js';

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
  private readonly continueWatching = new ContinueWatchingProvider();

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
        sections = await this.hydrateFallbackTemplates(client, locale);
        resolvedSource = 'fallback-built';
      }

      sections = await this.continueWatching.layer(sections, profileId, locale, region);

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

  private async hydrateFallbackTemplates(client: DbClient, locale: string | null): Promise<ClientHomeSection[]> {
    const templates = await this.repo.listFallbackTemplates();
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
        title: first.title,
        subtitle: first.subtitle,
        sectionType: first.sectionType,
        items: rows.map((row) => ({
          itemId: null,
          provider: row.provider,
          providerId: row.providerId,
          mediaType: row.mediaType,
          score: row.score,
          reason: row.reason,
          reasonCodes: row.reasonCodes,
        })),
      };
    }).filter((list): list is NonNullable<typeof list> => list !== null);
    return this.hydrator.hydrateSections(client, lists, locale);
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
