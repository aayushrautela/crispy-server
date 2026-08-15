import { withDbClient, db, type DbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { HomeModeService } from './home-mode.service.js';
import { HomeListsRepo } from './repos/home-lists.repo.js';
import { HomeHydrator } from './home-hydrator.service.js';
import { DefaultHomeWriteService, type HomeWriteService } from './home-write.service.js';
import { homeCacheKey } from './home-cache.js';
import { FallbackBuilderService } from './fallback/index.js';
import type { HomeMode, HomeSource, HomeWriteInput, HomeWriteResult } from './home-types.js';
import type { ClientHomeResponse, ClientHomeSection } from '../recommendations/client-home.types.js';

export type ResolvedHomeSource = 'custom' | 'reco' | 'fallback' | 'empty';

export type ResolveHomeResult = {
  response: ClientHomeResponse;
  mode: HomeMode;
  source: ResolvedHomeSource;
  generatedAt: string;
};

// Collapse concurrent cold misses for the same profile+locale into a single hydration.
const inFlightHomes = new Map<string, Promise<ResolveHomeResult>>();

export class HomeResolverService {
  private readonly modeService = new HomeModeService();
  private readonly hydrator = new HomeHydrator();

  constructor(
    private readonly profileLocalService = new ProfileLocalService(),
    private readonly repo = new HomeListsRepo({ db }),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly writeService: HomeWriteService = new DefaultHomeWriteService({ repo: new HomeListsRepo({ db }), contentIdentityService: new ContentIdentityService(), clock: { now: () => new Date() } }),
    private readonly fallbackBuilder: FallbackBuilderService = new FallbackBuilderService(),
  ) {}

  async resolveHome(accountId: string, profileId: string): Promise<ResolveHomeResult> {
    const profile = await this.profileLocalService.requireOwnedProfile(accountId, profileId);
    const locale = profile.interfaceLanguage || 'en-US';
    const region = profile.region ?? null;
    const cacheKey = homeCacheKey(profileId, locale, region);

    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = safeParse(cached);
      if (parsed) {
        return { response: parsed, mode: parsed.mode, source: parsed.source, generatedAt: parsed.generatedAt };
      }
    }

    const existing = inFlightHomes.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = withDbClient(async (client) => {
      const repo = new HomeListsRepo({ db: client });
      const mode = await this.modeService.getMode(accountId, profileId);
      const source = await this.pickSource(client, repo, accountId, profileId, mode);
      let sections: ClientHomeSection[];
      let resolvedSource: ResolvedHomeSource;

      if (source) {
        const lists = await repo.listActiveForSource({ accountId, profileId, source });
        sections = await this.hydrator.hydrateSections(client, lists, locale);
        resolvedSource = source;
      } else {
        // No rails under any source. Seed fallback in-band so the read is never
        // empty when templates exist; the seed-job path is a separate,
        // non-reliability enqueue. Use a unique idempotency key so the
        // ingester doesn't 409 against a prior seed-job record whose items
        // have since changed.
        await this.fallbackBuilder.buildForProfile(accountId, profileId, `home-heal:${accountId}:${profileId}:${Date.now()}`);
        const lists = await repo.listActiveForSource({ accountId, profileId, source: 'fallback' });
        if (lists.length > 0) {
          sections = await this.hydrator.hydrateSections(client, lists, locale);
          resolvedSource = 'fallback';
        } else {
          sections = [];
          resolvedSource = 'empty';
        }
      }

      const generatedAt = new Date().toISOString();
      const response: HomeCachePayload = {
        profileId,
        generatedAt,
        expiresAt: null,
        sections,
        source: resolvedSource,
        mode,
        locale,
        region,
      };
      await redis.set(cacheKey, JSON.stringify(response), 'EX', 30);
      return { response, mode, source: resolvedSource, generatedAt };
    }).finally(() => {
      inFlightHomes.delete(cacheKey);
    });

    inFlightHomes.set(cacheKey, promise);
    return promise;
  }

  async writeHome(input: HomeWriteInput): Promise<HomeWriteResult> {
    return this.writeService.writeHome(input);
  }

  /** Precedence: custom (custom mode) > reco (else) > fallback. */
  private async pickSource(
    client: DbClient,
    repo: HomeListsRepo,
    accountId: string,
    profileId: string,
    mode: HomeMode,
  ): Promise<HomeSource | null> {
    const candidates: HomeSource[] = mode === 'custom' ? ['custom', 'reco', 'fallback'] : ['reco', 'fallback'];
    for (const source of candidates) {
      if (await repo.hasActiveSourceRows({ accountId, profileId, source })) {
        return source;
      }
    }
    return null;
  }
}

type HomeCachePayload = ClientHomeResponse & {
  source: ResolvedHomeSource;
  mode: HomeMode;
  locale: string;
  region: string | null;
};

function safeParse(value: string): HomeCachePayload | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && Array.isArray(parsed.sections)) return parsed as HomeCachePayload;
    return null;
  } catch {
    return null;
  }
}
