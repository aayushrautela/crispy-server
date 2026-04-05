import type {
  ContinueWatchingProductItem,
  RatingProductItem,
  WatchedProductItem,
  WatchlistProductItem,
} from './watch-derived-item.types.js';
import { WatchCollectionService } from './watch-collection.service.js';
import { WatchReadService } from './watch-read.service.js';
import type { PaginatedWatchCollection } from './watch-read.types.js';

export class PersonalMediaService {
  constructor(
    private readonly watchReadService = new WatchReadService(),
    private readonly watchCollectionService = new WatchCollectionService(),
  ) {}

  async listContinueWatchingProducts(userId: string, profileId: string, limit: number): Promise<ContinueWatchingProductItem[]> {
    return this.watchReadService.listContinueWatchingProducts(userId, profileId, limit);
  }

  async listContinueWatchingPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<ContinueWatchingProductItem>> {
    return this.watchReadService.listContinueWatchingPage(userId, profileId, params);
  }

  async listWatchedProducts(userId: string, profileId: string, limit: number): Promise<WatchedProductItem[]> {
    return this.watchReadService.listWatchedProducts(userId, profileId, limit);
  }

  async countWatchedProducts(userId: string, profileId: string): Promise<number> {
    return this.watchReadService.countWatchedProducts(userId, profileId);
  }

  async listWatchedPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<WatchedProductItem>> {
    return this.watchReadService.listWatchedPage(userId, profileId, params);
  }

  async listWatchlistProducts(userId: string, profileId: string, limit: number): Promise<WatchlistProductItem[]> {
    return this.watchCollectionService.listWatchlistProducts(userId, profileId, limit);
  }

  async countWatchlistProducts(userId: string, profileId: string): Promise<number> {
    return this.watchCollectionService.countWatchlistProducts(userId, profileId);
  }

  async listWatchlistPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<WatchlistProductItem>> {
    return this.watchCollectionService.listWatchlistPage(userId, profileId, params);
  }

  async listRatingsProducts(userId: string, profileId: string, limit: number): Promise<RatingProductItem[]> {
    return this.watchCollectionService.listRatingsProducts(userId, profileId, limit);
  }

  async countRatingsProducts(userId: string, profileId: string): Promise<number> {
    return this.watchCollectionService.countRatingsProducts(userId, profileId);
  }

  async listRatingsPage(
    userId: string,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PaginatedWatchCollection<RatingProductItem>> {
    return this.watchCollectionService.listRatingsPage(userId, profileId, params);
  }
}
