import { withDbClient, type DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import type { LandscapeCardView, MetadataCardView, RegularCardView } from '../metadata/metadata-card.types.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ProfileRepository, type ProfileRecord } from '../profiles/profile.repo.js';
import { inferMediaIdentity } from '../identity/media-key.js';
import { WatchExportService, type TrackedSeriesExport } from '../watch/watch-export.service.js';
import { WatchMediaCardCacheService } from '../watch/watch-media-card-cache.service.js';
import { fallbackRegularCard } from '../watch/regular-card-fallback.js';

export type RecommendationDataListKind = 'watch-history' | 'continue-watching' | 'watchlist' | 'ratings' | 'tracked-series';

type ProfileSummary = {
  id: string;
  accountId: string | null;
  name: string;
  isKids: boolean;
  updatedAt: string;
};

type HydratedMedia = RegularCardView;
type HydratedLandscapeMedia = LandscapeCardView;

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
          media,
          watchedAt: requireDbIsoString(row.watchedAt, 'watch_history.watched_at'),
          payload: row.payload,
        }];
      });
    });
  }

  async getContinueWatchingForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      const rows = await this.watchExportService.listContinueWatching(client, profileId, limit);
      return Promise.all(rows.map(async (row) => ({
        id: row.id,
        media: await this.buildLandscapeMedia(client, row),
        progress: {
          positionSeconds: row.positionSeconds,
          durationSeconds: row.durationSeconds,
          progressPercent: row.progressPercent,
          lastPlayedAt: row.lastActivityAt,
        },
        lastActivityAt: row.lastActivityAt,
        payload: row.payload,
      })));
    });
  }

  async getContinueWatchingForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      const rows = await this.watchExportService.listContinueWatching(client, targetProfileId, limit);
      return Promise.all(rows.map(async (row) => ({
        id: row.id,
        media: await this.buildLandscapeMedia(client, row),
        progress: {
          positionSeconds: row.positionSeconds,
          durationSeconds: row.durationSeconds,
          progressPercent: row.progressPercent,
          lastPlayedAt: row.lastActivityAt,
        },
        lastActivityAt: row.lastActivityAt,
        payload: row.payload,
      })));
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

  async getTrackedSeriesForAccount(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      await this.requireOwnedProfile(client, accountId, profileId);
      return this.loadTrackedSeries(client, profileId, limit);
    });
  }

  async getTrackedSeriesForAccountService(accountId: string, profileId: string, limit: number) {
    return withDbClient(async (client) => {
      const targetProfileId = await this.resolveOwnedProfileId(client, accountId, profileId);
      return this.loadTrackedSeries(client, targetProfileId, limit);
    });
  }

  private async requireOwnedProfile(client: DbClient, accountId: string, profileId: string): Promise<void> {
    await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
  }

  private async resolveOwnedProfileId(client: DbClient, accountId: string, profileId: string): Promise<string> {
    const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
    return profile.id;
  }

  private async loadTrackedSeries(client: DbClient, profileId: string, limit: number) {
    const rows = await this.watchExportService.listTrackedSeries(client, profileId, limit);
    return Promise.all(rows.map(async (row) => {
      const identity = inferMediaIdentity({
        mediaKey: row.trackedMediaKey,
        mediaType: row.trackedMediaType as 'show' | 'anime' | 'movie' | 'season' | 'episode',
        provider: row.provider as 'tmdb' | 'tvdb' | 'kitsu' | undefined,
        providerId: row.providerId ? Number(row.providerId) : null,
      });
      return {
        show: await this.metadataCardService.buildCardView(client, identity),
        reason: row.reason,
        lastInteractedAt: row.lastInteractedAt,
        nextEpisodeAirDate: row.nextEpisodeAirDate,
        metadataRefreshedAt: row.metadataRefreshedAt,
        payload: row.payload,
      };
    }));
  }

  private async buildLandscapeMedia(client: DbClient, row: Record<string, unknown>): Promise<HydratedLandscapeMedia> {
    return toLandscapeCard(await this.metadataCardService.buildCardViewFromRow(client, row));
  }
}

function toLandscapeCard(card: MetadataCardView): LandscapeCardView {
  const posterUrl = card.images.posterUrl ?? card.artwork.posterUrl ?? '';
  const backdropUrl = card.images.stillUrl ?? card.artwork.stillUrl ?? card.images.backdropUrl ?? card.artwork.backdropUrl ?? posterUrl;
  return {
    mediaType: card.mediaType,
    mediaKey: card.mediaKey,
    provider: card.provider,
    providerId: card.providerId,
    title: card.title ?? 'Untitled',
    posterUrl,
    backdropUrl,
    releaseYear: card.releaseYear,
    rating: card.rating,
    genre: null,
    seasonNumber: card.seasonNumber,
    episodeNumber: card.episodeNumber,
    episodeTitle: card.mediaType === 'episode' ? card.title : null,
    airDate: card.releaseDate,
    runtimeMinutes: card.runtimeMinutes,
  };
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
