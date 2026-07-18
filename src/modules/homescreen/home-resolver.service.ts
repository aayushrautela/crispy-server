import { withDbClient, type DbClient } from '../../lib/db.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { RecommendationSnapshotsRepository } from '../recommendations/recommendation-snapshots.repo.js';
import { RecommendationSnapshotHydrator } from '../recommendations/recommendation-snapshot-hydrator.js';
import { recommendationConfig } from '../recommendations/recommendation-config.js';
import { HomeModeService } from './home-mode.service.js';
import { DefaultHomeBuilder } from './default-home.builder.js';
import { DefaultHomeCacheService } from './default-home.cache.service.js';
import { ContinueWatchingProvider } from './providers/continue-watching.provider.js';
import type { ClientHomeResponse, ClientHomeSection } from '../recommendations/client-home.types.js';
import type { HomeMode } from './homescreen.types.js';

export type ResolvedHomeSource = 'custom' | 'recommended' | 'default-cached' | 'default-built';

export type ResolveHomeResult = {
  response: ClientHomeResponse;
  mode: HomeMode;
  source: ResolvedHomeSource;
  generatedAt: string;
};

export class HomeResolverService {
  constructor(
    private readonly profileLocalService = new ProfileLocalService(),
    private readonly homeModeService = new HomeModeService(),
    private readonly snapshotsRepository = new RecommendationSnapshotsRepository(),
    private readonly hydrator = new RecommendationSnapshotHydrator(),
    private readonly builder = new DefaultHomeBuilder(),
    private readonly cache = new DefaultHomeCacheService(),
    private readonly continueWatchingProvider = new ContinueWatchingProvider(),
  ) {}

  async resolveHome(accountId: string, profileId: string): Promise<ResolveHomeResult> {
    const profile = await this.profileLocalService.requireOwnedProfile(accountId, profileId);
    const mode = await this.homeModeService.getMode(accountId, profileId);

    const locale = profile.interfaceLanguage || 'en-US';
    const region = profile.region ?? null;

    if (mode === 'custom') {
      const custom = await this.readSnapshot(accountId, profileId, 'user');
      if (custom) {
        return { response: custom, mode, source: 'custom', generatedAt: custom.generatedAt };
      }
      // Custom mode but no user snapshot yet: fall through to default so the
      // user still sees something instead of an empty home.
    } else {
      const reco = await this.readSnapshot(accountId, profileId, 'service');
      if (reco) {
        return { response: reco, mode, source: 'recommended', generatedAt: reco.generatedAt };
      }
    }

    const cached = await this.cache.getBuilt(locale);
    if (cached) {
      const sections = await this.layerContinueWatching(cached.sections, profileId, locale, region);
      return {
        response: { profileId, generatedAt: cached.generatedAt, expiresAt: null, sections },
        mode,
        source: 'default-cached',
        generatedAt: cached.generatedAt,
      };
    }

    const built = await this.builder.build(locale, region);
    await this.cache.storeBuilt(locale, built, accountId);
    const sections = await this.layerContinueWatching(built, profileId, locale, region);
    const generatedAt = new Date().toISOString();
    return {
      response: { profileId, generatedAt, expiresAt: null, sections },
      mode,
      source: 'default-built',
      generatedAt,
    };
  }

  private async readSnapshot(accountId: string, profileId: string, source: 'user' | 'service'): Promise<ClientHomeResponse | null> {
    return withDbClient(async (client: DbClient) => {
      const row = await this.snapshotsRepository.findByProfileSourceAndAlgorithm(
        client,
        profileId,
        recommendationConfig.sourceKey,
        recommendationConfig.algorithmVersion,
      );
      if (!row) {
        return null;
      }
      const sections = await this.hydrateSections(client, row.items);
      if (sections.length === 0) {
        return null;
      }
      return { profileId, generatedAt: row.generatedAt, expiresAt: row.expiresAt, sections };
    });
  }

  private async hydrateSections(client: DbClient, items: unknown[]): Promise<ClientHomeSection[]> {
    const resolved = await Promise.all(items.map((item) => this.hydrator.hydrateSection(client, item)));
    return resolved.filter((section): section is ClientHomeSection => section !== null);
  }

  private async layerContinueWatching(
    sections: ClientHomeSection[],
    profileId: string,
    locale: string,
    region: string | null,
  ): Promise<ClientHomeSection[]> {
    return this.continueWatchingProvider.layer(sections, profileId, locale, region);
  }
}
