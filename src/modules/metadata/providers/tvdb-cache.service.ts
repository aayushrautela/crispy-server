import { appConfig } from '../../../config/app-config.js';
import type { DbClient } from '../../../lib/db.js';
import { addHours } from './tmdb-time.js';
import { TvdbClient } from './tvdb.client.js';
import { TvdbRepository } from './tvdb.repo.js';
import { buildTvdbBundleFromPayloads, extractTvdbEpisodeItems } from './provider-bundle-normalizers.js';
import type { CachedTvdbTitleBundleRecord, ProviderTitleBundle } from './provider-bundle.types.js';

export class TvdbCacheService {
  constructor(
    private readonly tvdbRepository = new TvdbRepository(),
    private readonly tvdbClient = new TvdbClient(),
  ) {}

  async getTitleBundle(client: DbClient, seriesId: string, language?: string | null): Promise<ProviderTitleBundle | null> {
    const cached = await this.tvdbRepository.getTitleBundle(client, seriesId);
    if (cached && Date.parse(cached.expiresAt) > Date.now()) {
      return buildTvdbBundleFromPayloads(cached.payload.seriesPayload, cached.payload.episodesPayload, seriesId, language ?? null);
    }

    try {
      const refreshed = await this.refreshTitleBundle(client, seriesId, language ?? null);
      return refreshed;
    } catch (error) {
      if (cached) {
        return buildTvdbBundleFromPayloads(cached.payload.seriesPayload, cached.payload.episodesPayload, seriesId, language ?? null);
      }
      throw error;
    }
  }

  async ensureTitleBundleCached(client: DbClient, seriesId: string, language?: string | null): Promise<ProviderTitleBundle | null> {
    return this.getTitleBundle(client, seriesId, language ?? null);
  }

  async refreshTitleBundle(client: DbClient, seriesId: string, language?: string | null): Promise<ProviderTitleBundle> {
    const [seriesPayload, episodesPayload] = await Promise.all([
      this.tvdbClient.fetchSeriesExtended(seriesId),
      this.fetchTvdbEpisodesWithFallback(seriesId).catch(() => ({ data: [] })),
    ]);

    const now = new Date().toISOString();
    const record: CachedTvdbTitleBundleRecord = {
      providerId: seriesId,
      payload: {
        seriesPayload,
        episodesPayload,
      },
      fetchedAt: now,
      expiresAt: addHours(now, appConfig.cache.tvdb.showTtlHours),
    };
    await this.tvdbRepository.upsertTitleBundle(client, record);
    return buildTvdbBundleFromPayloads(seriesPayload, episodesPayload, seriesId, language ?? null);
  }

  private async fetchTvdbEpisodesWithFallback(seriesId: string): Promise<Record<string, unknown>> {
    const defaultPayload = await this.tvdbClient.fetchSeriesEpisodes(seriesId, 'default').catch(() => ({ data: [] }));
    const defaultEpisodes = extractTvdbEpisodeItems(defaultPayload);
    if (defaultEpisodes.length > 0) {
      return defaultPayload;
    }

    return this.tvdbClient.fetchSeriesEpisodes(seriesId, 'official').catch(() => ({ data: [] }));
  }
}
