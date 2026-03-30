import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { RatingsRepository } from './ratings.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';
import type { HydratedRatingItem, HydratedWatchlistItem } from './watch-read.types.js';

export class WatchCollectionService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly metadataCardService = new MetadataCardService(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
  ) {}

  async listWatchlist(userId: string, profileId: string, limit: number): Promise<HydratedWatchlistItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.watchlistRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => this.mapWatchlistRow(client, row)));
    });
  }

  async listRatings(userId: string, profileId: string, limit: number): Promise<HydratedRatingItem[]> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const rows = await this.ratingsRepository.list(client, profileId, limit);
      return Promise.all(rows.map(async (row) => this.mapRatingRow(client, row)));
    });
  }

  private async mapWatchlistRow(client: DbClient, row: Record<string, unknown>): Promise<HydratedWatchlistItem> {
    const media = await this.metadataCardService.buildCardViewFromRow(client, row);

    return {
      media,
      addedAt: requireDbIsoString(row.added_at as Date | string | null | undefined, 'watchlist_items.added_at'),
      payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    };
  }

  private async mapRatingRow(client: DbClient, row: Record<string, unknown>): Promise<HydratedRatingItem> {
    const media = await this.metadataCardService.buildCardViewFromRow(client, row);

    return {
      media,
      rating: {
        value: Number(row.rating),
        ratedAt: requireDbIsoString(row.rated_at as Date | string | null | undefined, 'ratings.rated_at'),
      },
      payload: (row.payload as Record<string, unknown> | undefined) ?? {},
    };
  }
}
