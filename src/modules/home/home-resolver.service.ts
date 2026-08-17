import { withDbClient, db, type DbClient } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { appConfig } from '../../config/app-config.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { HomeModeService } from './home-mode.service.js';
import { HomeListsRepo } from './repos/home-lists.repo.js';
import { HomeHydrator } from './home-hydrator.service.js';
import { DefaultHomeWriteService, type HomeWriteService } from './home-write.service.js';
import { homeCacheKey, readHomeEpoch } from './home-cache.js';
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

// Collapse concurrent cold misses AND background-refresh triggers for the same
// profile+locale+region into a single hydration pass.
const inFlightHomes = new Map<string, Promise<ResolveHomeResult>>();

type BuildContext = {
  accountId: string;
  profileId: string;
  locale: string;
  region: string | null;
  cacheKey: string;
};

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

    const cachedRaw = await redis.get(cacheKey);
    if (cachedRaw) {
      const parsed = safeParse(cachedRaw);
      if (parsed) {
        const ageMs = Date.now() - Date.parse(parsed.generatedAt);
        if (Number.isFinite(ageMs) && ageMs < appConfig.cache.home.freshSeconds * 1000) {
          return { response: parsed, mode: parsed.mode, source: parsed.source, generatedAt: parsed.generatedAt };
        }
        // Stale but valid: serve immediately, refresh in the background.
        this.scheduleBackgroundRefresh({ accountId, profileId, locale, region, cacheKey });
        return { response: parsed, mode: parsed.mode, source: parsed.source, generatedAt: parsed.generatedAt };
      }
    }

    const inFlight = inFlightHomes.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.rebuild({ accountId, profileId, locale, region, cacheKey })
      .finally(() => {
        inFlightHomes.delete(cacheKey);
      });
    inFlightHomes.set(cacheKey, promise);
    return promise;
  }

  /**
   * Fire-and-forget refresh used by stale-while-revalidate. Never throws,
   * deduped against any concurrent foreground rebuild via `inFlightHomes`.
   */
  private scheduleBackgroundRefresh(ctx: BuildContext): void {
    if (inFlightHomes.has(ctx.cacheKey)) return;
    const refresh = this.rebuild(ctx)
      .then(() => undefined)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        // Background refresh is best-effort. A failure here means the next
        // read will either retry SWR or fall through to a fresh cold rebuild.
        // eslint-disable-next-line no-console
        console.error(`home background refresh failed for ${ctx.profileId}: ${message}`);
      })
      .finally(() => {
        inFlightHomes.delete(ctx.cacheKey);
      });
    // The slot is intentionally held by an opaque Promise so a concurrent
    // foreground call joins the same rebuild instead of starting a second.
    inFlightHomes.set(ctx.cacheKey, refresh as unknown as Promise<ResolveHomeResult>);
  }

  private async rebuild(ctx: BuildContext): Promise<ResolveHomeResult> {
    const epochBefore = await readHomeEpoch(ctx.profileId);

    const result = await withDbClient(async (client) => {
      const repo = new HomeListsRepo({ db: client });
      const mode = await this.modeService.getMode(ctx.accountId, ctx.profileId);
      const source = await this.pickSource(client, repo, ctx.accountId, ctx.profileId, mode);
      let sections: ClientHomeSection[];
      let resolvedSource: ResolvedHomeSource;

      if (source) {
        const lists = await repo.listActiveForSource({ accountId: ctx.accountId, profileId: ctx.profileId, source });
        sections = await this.hydrator.hydrateSections(client, lists, ctx.locale);
        resolvedSource = source;
      } else {
        // No rails under any source. Seed fallback in-band so the read is
        // never empty when templates exist; the seed-job path is a separate,
        // non-reliability enqueue. Use a unique idempotency key so the
        // ingester doesn't 409 against a prior seed-job record whose items
        // have since changed.
        await this.fallbackBuilder.buildForProfile(ctx.accountId, ctx.profileId, `home-heal:${ctx.accountId}:${ctx.profileId}:${Date.now()}`);
        const lists = await repo.listActiveForSource({ accountId: ctx.accountId, profileId: ctx.profileId, source: 'fallback' });
        if (lists.length > 0) {
          sections = await this.hydrator.hydrateSections(client, lists, ctx.locale);
          resolvedSource = 'fallback';
        } else {
          sections = [];
          resolvedSource = 'empty';
        }
      }

      const generatedAt = new Date().toISOString();
      const freshSeconds = appConfig.cache.home.freshSeconds;
      const response: HomeCachePayload = {
        profileId: ctx.profileId,
        generatedAt,
        // `expiresAt` tells the client when the server may swap in a fresher
        // payload; the actual Redis TTL is `staleSeconds` (stale-while-revalidate).
        expiresAt: new Date(Date.parse(generatedAt) + freshSeconds * 1000).toISOString(),
        sections,
        source: resolvedSource,
        mode,
        locale: ctx.locale,
        region: ctx.region,
      };

      // Only persist if no write invalidated the profile while we were building.
      // Without this guard, a stale-while-revalidate refresh that started
      // before a new reco write would clobber the invalidated key with the
      // pre-write payload.
      const epochAfter = await readHomeEpoch(ctx.profileId);
      if (epochAfter === epochBefore) {
        await redis.set(ctx.cacheKey, JSON.stringify(response), 'EX', appConfig.cache.home.staleSeconds);
      }

      return { response, mode, source: resolvedSource, generatedAt };
    });

    return result;
  }

  async writeHome(input: HomeWriteInput): Promise<HomeWriteResult> {
    return this.writeService.writeHome(input);
  }

  /** Precedence: custom (custom mode) > reco (else) > fallback. One query. */
  private async pickSource(
    client: DbClient,
    repo: HomeListsRepo,
    accountId: string,
    profileId: string,
    mode: HomeMode,
  ): Promise<HomeSource | null> {
    const candidates: readonly HomeSource[] = mode === 'custom'
      ? ['custom', 'reco', 'fallback']
      : ['reco', 'fallback'];
    return repo.findActiveSource({ accountId, profileId, sources: candidates });
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
