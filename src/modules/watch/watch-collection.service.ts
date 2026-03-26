import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { RatingsRepository } from './ratings.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';
import type { HydratedRatingItem, HydratedWatchlistItem } from './watch-read.types.js';

export class WatchCollectionService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly metadataViewService = new MetadataViewService(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
  ) {}

  async listWatchlist(userId: string, profileId: string, limit: number): Promise<HydratedWatchlistItem[]> {
    return withDbClient(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const rows = await this.watchlistRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => this.mapWatchlistRow(client, row)));
    });
  }

  async listRatings(userId: string, profileId: string, limit: number): Promise<HydratedRatingItem[]> {
    return withDbClient(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const rows = await this.ratingsRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => this.mapRatingRow(client, row)));
    });
  }

  private async mapWatchlistRow(client: DbClient, row: Record<string, unknown>): Promise<HydratedWatchlistItem> {
    const media = await this.metadataViewService.buildMetadataCardViewFromRow(client, row);

    return {
      media,
      addedAt: String(row.added_at),
      payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    };
  }

  private async mapRatingRow(client: DbClient, row: Record<string, unknown>): Promise<HydratedRatingItem> {
    const media = await this.metadataViewService.buildMetadataCardViewFromRow(client, row);

    return {
      media,
      rating: {
        value: Number(row.rating),
        ratedAt: String(row.rated_at),
      },
      payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    };
  }
}
