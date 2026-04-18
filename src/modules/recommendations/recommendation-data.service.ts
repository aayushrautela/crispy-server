import { withDbClient, type DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import type { RegularCardView } from '../metadata/metadata-card.types.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ProfileRepository, type ProfileRecord } from '../profiles/profile.repo.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { WatchExportService } from '../watch/watch-export.service.js';
import { WatchMediaCardCacheService } from '../watch/watch-media-card-cache.service.js';
import { fallbackRegularCard } from '../watch/regular-card-fallback.js';
import type { EpisodicFollowView } from '../watch/watch-episodic-follow.types.js';

export type RecommendationDataListKind = 'watch-history' | 'watchlist' | 'ratings' | 'episodic-follow';

type ProfileSummary = {
  id: string;
  accountId: string | null;
  name: string;
  isKids: boolean;
  updatedAt: string;
};

type HydratedMedia = RegularCardView;

export class RecommendationDataService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly profileRepository = new ProfileRepository(),
    private readonly metadataCardService = new MetadataCardService(),
    private readonly watchExportService = new WatchExportService(),
    private readonly watchMediaCardCacheService = new WatchMediaCardCacheService(),
  ) {}

  async listAccountProfiles(accountId: string): Promise<ProfileSummary[]> {
    return withDbClient(async (client) => {
      const profiles = await this.profileRepository.listForOwnerUser(client, accountId);
      return Promise.all(profiles.map((profile) => toProfileSummary(this.profileAccessService, client, profile)));
    });
  }

  async listAccountProfilesForService(accountId: string): Promise<ProfileSummary[]> {
    return withDbClient(async (client) => {
      const profiles = await this.profileRepository.listForOwnerUser(client, accountId);
      return Promise.all(profiles.map((profile) => toProfileSummary(this.profileAccessService, client, profile)));
    });
  }

  async getWatchHistoryForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.watchExportService.listWatchHistory(client, profileId, limit);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, rows.map((row) => row.mediaKey));
      return rows.flatMap((row) => {
        const media = mediaMap.get(row.mediaKey) ?? fallbackRegularCard(
          row.mediaKey,
          row.title,
          row.posterUrl,
          row.subtitle,
          row.detailsReleaseYear,
          row.detailsRating,
        );
        if (!media) {
          return [];
        }
        return [{
          id: row.id,
          media,
          watchedAt: requireDbIsoString(row.watchedAt, 'watch_history.watched_at'),
          payload: row.payload,
        }];
      });
    });
  }

  async getWatchHistoryForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      const rows = await this.watchExportService.listWatchHistory(client, targetProfileId, limit);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, rows.map((row) => row.mediaKey));
      return rows.flatMap((row) => {
        const media = mediaMap.get(row.mediaKey) ?? fallbackRegularCard(
          row.mediaKey,
          row.title,
          row.posterUrl,
          row.subtitle,
          row.detailsReleaseYear,
          row.detailsRating,
        );
        if (!media) {
          return [];
        }
        return [{
          id: row.id,
          media,
          watchedAt: requireDbIsoString(row.watchedAt, 'watch_history.watched_at'),
          payload: row.payload,
        }];
      });
    });
  }

  async getWatchlistForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.watchExportService.listWatchlist(client, profileId, limit);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, rows.map((row) => row.mediaKey));
      return rows.flatMap((row) => {
        const media = mediaMap.get(row.mediaKey) ?? fallbackRegularCard(
          row.mediaKey,
          row.title,
          row.posterUrl,
          row.subtitle,
          row.releaseYear,
          row.titleRating,
        );
        if (!media) {
          return [];
        }
        return [{
          id: row.id,
          media,
          addedAt: row.addedAt,
          payload: row.payload,
        }];
      });
    });
  }

  async getWatchlistForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      const rows = await this.watchExportService.listWatchlist(client, targetProfileId, limit);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, rows.map((row) => row.mediaKey));
      return rows.flatMap((row) => {
        const media = mediaMap.get(row.mediaKey) ?? fallbackRegularCard(
          row.mediaKey,
          row.title,
          row.posterUrl,
          row.subtitle,
          row.releaseYear,
          row.titleRating,
        );
        if (!media) {
          return [];
        }
        return [{
          id: row.id,
          media,
          addedAt: row.addedAt,
          payload: row.payload,
        }];
      });
    });
  }

  async getRatingsForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.watchExportService.listRatings(client, profileId, limit);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, rows.map((row) => row.mediaKey));
      return rows.flatMap((row) => {
        const media = mediaMap.get(row.mediaKey) ?? fallbackRegularCard(
          row.mediaKey,
          row.title,
          row.posterUrl,
          row.subtitle,
          row.releaseYear,
          row.titleRating,
        );
        if (!media) {
          return [];
        }
        return [{
          id: row.id,
          media,
          rating: {
            value: row.rating,
            ratedAt: row.ratedAt,
          },
          payload: row.payload,
        }];
      });
    });
  }

  async getRatingsForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      const rows = await this.watchExportService.listRatings(client, targetProfileId, limit);
      const mediaMap = await this.watchMediaCardCacheService.listRegularCards(client, rows.map((row) => row.mediaKey));
      return rows.flatMap((row) => {
        const media = mediaMap.get(row.mediaKey) ?? fallbackRegularCard(
          row.mediaKey,
          row.title,
          row.posterUrl,
          row.subtitle,
          row.releaseYear,
          row.titleRating,
        );
        if (!media) {
          return [];
        }
        return [{
          id: row.id,
          media,
          rating: {
            value: row.rating,
            ratedAt: row.ratedAt,
          },
          payload: row.payload,
        }];
      });
    });
  }

  async getEpisodicFollowForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      return this.loadEpisodicFollow(client, profileId, limit);
    });
  }

  async getEpisodicFollowForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      return this.loadEpisodicFollow(client, targetProfileId, limit);
    });
  }

  private async requireOwnedProfile(client: DbClient, accountId: string, profileId: string): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
  }

  private async resolveOwnedProfileId(client: DbClient, accountId: string, profileId: string): Promise<string> {
    const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
    return profile.id;
  }

  private async loadEpisodicFollow(client: DbClient, profileId: string, limit: number): Promise<EpisodicFollowView[]> {
    const rows = await this.watchExportService.listEpisodicFollow(client, profileId, limit);
    return Promise.all(rows.map(async (row) => {
      const identity = inferMediaIdentity({
        mediaKey: row.seriesMediaKey,
        mediaType: 'show',
        provider: 'tmdb',
        providerId: row.providerId ? Number(row.providerId) : null,
      });
      return {
        show: await this.metadataCardService.buildCardView(client, identity),
        reason: row.reason,
        lastInteractedAt: row.lastInteractedAt,
        nextEpisodeAirDate: row.nextEpisodeAirDate,
        nextEpisodeMediaKey: row.nextEpisodeMediaKey,
        nextEpisodeSeasonNumber: row.nextEpisodeSeasonNumber,
        nextEpisodeEpisodeNumber: row.nextEpisodeEpisodeNumber,
        nextEpisodeAbsoluteEpisodeNumber: row.nextEpisodeAbsoluteEpisodeNumber,
        nextEpisodeTitle: row.nextEpisodeTitle,
        metadataRefreshedAt: row.metadataRefreshedAt,
        payload: row.payload,
      };
    }));
  }
}

async function toProfileSummary(
  profileAccessService: ProfileAccessService,
  client: DbClient,
  profile: ProfileRecord,
): Promise<ProfileSummary> {
  const accountId = await profileAccessService.findOwnerUserId(client, profile.id);
  return {
    id: profile.id,
    accountId,
    name: profile.name,
    isKids: profile.isKids,
    updatedAt: profile.updatedAt,
  };
}
