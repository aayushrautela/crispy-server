import { withDbClient, db, type DbClient } from '../../../lib/db.js';
import { redis } from '../../../lib/redis.js';
import { env } from '../../../config/env.js';
import { HttpError } from '../../../lib/errors.js';
import { ContentIdentityService } from '../../identity/content-identity.service.js';
import { encodePublicItemId } from '../../identity/public-item-id.js';
import { inferMediaIdentity, type MediaIdentity, type SupportedMediaType, type SupportedProvider } from '../../identity/media-key.js';
import { HomeHydrator } from '../home-hydrator.service.js';
import { getListSource } from '../list-sources/list-source.registry.js';
import type { HomeWriteItemLite, ListSourceCtx } from '../list-sources/list-source.types.js';
import { HomeListsRepo } from '../repos/home-lists.repo.js';
import type { ClientHomeSection } from '../../recommendations/client-home.types.js';
import { DEFAULT_SECTION_LIMITS, type DefaultTemplate } from './default-templates.js';

const DEFAULT_HOME_TTL_SECONDS = env.homescreenDefaultTtlSeconds;
const DEFAULT_HOME_VERSION_KEY = 'home:default:ver';
const DEFAULT_HOME_SNAPSHOT_KEY = 'home:default:en';
const EMPTY_MARKER = '__empty__';

const inFlightBuilds = new Map<string, Promise<ClientHomeSection[] | null>>();

/**
 * Builds and serves the shared default home. There is exactly one snapshot
 * (English), cached in Redis and reused across every profile. It is never
 * materialized into per-profile rows — the resolver reads it directly when a
 * profile has no custom/reco home.
 *
 * Template edits bump a Redis version counter so stale snapshots expire on
 * TTL instead of being enumerated. Concurrent misses collapse into one build
 * via `inFlightBuilds`.
 *
 * Kids profiles are excluded in v1 (the resolver never calls this for them);
 * a kids-specific template filter is a later addition.
 */
export class DefaultHomeBuilderService {
  private readonly repo: HomeListsRepo;
  private readonly contentIdentityService: ContentIdentityService;
  private readonly hydrator: HomeHydrator;

  constructor(deps?: { repo?: HomeListsRepo; contentIdentityService?: ContentIdentityService; hydrator?: HomeHydrator }) {
    this.repo = deps?.repo ?? new HomeListsRepo({ db });
    this.contentIdentityService = deps?.contentIdentityService ?? new ContentIdentityService();
    this.hydrator = deps?.hydrator ?? new HomeHydrator();
  }

  /** Call after any template upsert/delete so cached snapshots rebuild. */
  async bumpVersion(): Promise<void> {
    await redis.incr(DEFAULT_HOME_VERSION_KEY);
  }

  async getSharedDefault(): Promise<ClientHomeSection[] | null> {
    const version = await this.readVersion();
    const key = `${DEFAULT_HOME_SNAPSHOT_KEY}:${version}`;
    const cached = await redis.get(key);
    if (cached === EMPTY_MARKER) return null;
    if (cached) {
      try {
        return JSON.parse(cached) as ClientHomeSection[];
      } catch {
        // Corrupt payload: fall through to a rebuild.
      }
    }
    return this.buildAndCache(key);
  }

  private async readVersion(): Promise<string> {
    const raw = await redis.get(DEFAULT_HOME_VERSION_KEY);
    return raw ?? '0';
  }

  private async buildAndCache(key: string): Promise<ClientHomeSection[] | null> {
    const existing = inFlightBuilds.get(key);
    if (existing) return existing;

    const promise = this.build()
      .then(async (sections) => {
        if (sections.length === 0) {
          // Cache a short-lived empty marker so a misconfigured/empty template
          // set doesn't trigger a live rebuild on every read.
          await redis.set(key, EMPTY_MARKER, 'EX', Math.min(DEFAULT_HOME_TTL_SECONDS, 300));
          return null;
        }
        await redis.set(key, JSON.stringify(sections), 'EX', DEFAULT_HOME_TTL_SECONDS);
        return sections;
      })
      .finally(() => {
        inFlightBuilds.delete(key);
      });

    inFlightBuilds.set(key, promise);
    return promise;
  }

  private async build(): Promise<ClientHomeSection[]> {
    return withDbClient(async (client) => {
      const templates = await this.repo.listDefaultTemplates();
      if (templates.length === 0) return [];

      const tmdbLanguage = 'en';
      const baseCtx: ListSourceCtx = {
        client,
        profileId: '',
        locale: 'en',
        region: null,
        isKids: false,
        connectedProviders: [],
        tmdbLanguage,
        tmdbRegion: undefined,
        limit: 0,
      };

      const lists = await this.buildLists(client, templates, baseCtx);
      if (lists.length === 0) return [];
      return this.hydrator.hydrateSections(client, lists, tmdbLanguage);
    });
  }

  private async buildLists(
    client: DbClient,
    templates: DefaultTemplate[],
    baseCtx: ListSourceCtx,
  ): Promise<Array<{ listKey: string; title: string; subtitle: string | null; sectionType: string; items: unknown[] }>> {
    const lists: Array<{ listKey: string; title: string; subtitle: string | null; sectionType: string; items: unknown[] }> = [];
    for (const template of templates) {
      const source = getListSource(template.sourceId);
      if (!source) continue;
      const limit = DEFAULT_SECTION_LIMITS[template.sectionType] ?? 40;
      const ctx: ListSourceCtx = { ...baseCtx, region: template.regionOverride ?? null, limit };
    let items: HomeWriteItemLite[] = [];
    let meta: Record<string, unknown> | undefined;
    try {
      const result = await source.fetchItems(template.sourceConfig, ctx);
      items = result.items;
      meta = result.meta;
    } catch (error) {
      console.error(`default-home source ${template.sourceId} failed for ${template.listKey}:`, error);
    }
    if (items.length === 0) continue;
    const rows = await this.toHydrationRows(client, items);
    if (rows.length === 0) continue;
    // Sources may override the template title/subtitle at runtime (e.g. the
    // trending person pill carries the picked actor's name, the genre pill
    // carries the day's genre).
    const metaTitle = typeof meta?.title === 'string' && meta.title ? meta.title : null;
    const metaSubtitle = typeof meta?.subtitle === 'string' && meta.subtitle ? meta.subtitle : null;
    lists.push({
      listKey: template.listKey,
      title: metaTitle ?? template.title,
      subtitle: metaSubtitle ?? template.subtitle,
      sectionType: template.sectionType,
      items: rows,
    });
    }
    return lists;
  }

  /**
   * Resolve list-source items to hydration rows. Provider refs are
   * canonicalized into content ids (materializing canonical rows as needed),
   * so the hydrator can take its fast batched `itemId` path.
   */
  private async toHydrationRows(client: DbClient, items: HomeWriteItemLite[]): Promise<Array<Record<string, unknown>>> {
    const identities: MediaIdentity[] = items.map((item, index) => {
      const ref = item.providerRefs[0];
      if (!ref) {
        throw new HttpError(422, `default-home item ${index} missing a provider ref.`);
      }
      const mediaType: SupportedMediaType = item.type === 'tv' ? 'show' : 'movie';
      const provider: SupportedProvider = ref.provider === 'tvdb' || ref.provider === 'imdb' || ref.provider === 'kitsu' ? ref.provider : 'tmdb';
      return inferMediaIdentity({
        mediaType,
        provider,
        providerId: ref.providerId,
        tmdbId: provider === 'tmdb' ? Number(ref.providerId) : null,
        providerMetadata: item.metadata,
      });
    });

    const resolved = await this.contentIdentityService.ensureContentIds(client, identities);
    const rows: Array<Record<string, unknown>> = [];
    identities.forEach((identity) => {
      const contentId = identity?.mediaKey ? resolved.get(identity.mediaKey) : undefined;
      if (!contentId) return;
      rows.push({ itemId: encodePublicItemId(contentId) });
    });
    return rows;
  }
}
