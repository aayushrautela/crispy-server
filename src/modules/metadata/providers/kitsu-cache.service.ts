import { appConfig } from '../../../config/app-config.js';
import type { DbClient } from '../../../lib/db.js';
import { addHours } from './tmdb-time.js';
import { KitsuClient } from './kitsu.client.js';
import { KitsuRepository } from './kitsu.repo.js';
import { buildKitsuBundleFromPayloads } from './provider-bundle-normalizers.js';
import type { CachedKitsuTitleBundleRecord, ProviderTitleBundle } from './provider-bundle.types.js';

export class KitsuCacheService {
  constructor(
    private readonly kitsuRepository = new KitsuRepository(),
    private readonly kitsuClient = new KitsuClient(),
  ) {}

  async getTitleBundle(client: DbClient, animeId: string): Promise<ProviderTitleBundle | null> {
    const cached = await this.kitsuRepository.getTitleBundle(client, animeId);
    if (cached && Date.parse(cached.expiresAt) > Date.now()) {
      return buildKitsuBundleFromPayloads(cached.payload, animeId);
    }

    try {
      return await this.refreshTitleBundle(client, animeId);
    } catch (error) {
      if (cached) {
        return buildKitsuBundleFromPayloads(cached.payload, animeId);
      }
      throw error;
    }
  }

  async ensureTitleBundleCached(client: DbClient, animeId: string): Promise<ProviderTitleBundle | null> {
    return this.getTitleBundle(client, animeId);
  }

  async refreshTitleBundle(client: DbClient, animeId: string): Promise<ProviderTitleBundle> {
    const [animePayload, episodesPayload, charactersPayload, staffPayload, relationshipsPayload, productionsPayload, reviewsPayload] = await Promise.all([
      this.kitsuClient.fetchAnime(animeId),
      this.fetchAllEpisodes(animeId).catch(() => ({ data: [] })),
      this.kitsuClient.fetchAnimeCharacters(animeId).catch(() => ({ data: [], included: [] })),
      this.kitsuClient.fetchAnimeStaff(animeId).catch(() => ({ data: [], included: [] })),
      this.kitsuClient.fetchAnimeRelationships(animeId).catch(() => ({ data: [], included: [] })),
      this.kitsuClient.fetchAnimeProductions(animeId).catch(() => ({ data: [] })),
      this.kitsuClient.fetchAnimeReviews(animeId).catch(() => ({ data: [] })),
    ]);

    const now = new Date().toISOString();
    const record: CachedKitsuTitleBundleRecord = {
      providerId: animeId,
      payload: {
        animePayload,
        episodesPayload,
        charactersPayload,
        staffPayload,
        relationshipsPayload,
        productionsPayload,
        reviewsPayload,
      },
      fetchedAt: now,
      expiresAt: addHours(now, appConfig.cache.kitsu.animeTtlHours),
    };
    await this.kitsuRepository.upsertTitleBundle(client, record);
    return buildKitsuBundleFromPayloads(record.payload, animeId);
  }

  private async fetchAllEpisodes(animeId: string): Promise<Record<string, unknown>> {
    const data: unknown[] = [];
    let offset = 0;
    const pageSize = 20;

    for (;;) {
      const payload = await this.kitsuClient.fetchAnimeEpisodes(animeId, pageSize, offset);
      const page = Array.isArray(payload.data) ? payload.data : [];
      if (!page.length) {
        break;
      }
      data.push(...page);
      if (page.length < pageSize) {
        break;
      }
      offset += page.length;
    }

    return { data };
  }
}
