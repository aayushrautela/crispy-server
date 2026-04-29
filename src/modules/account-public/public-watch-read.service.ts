import { withDbClient } from '../../lib/db.js';
import type { PublicWatchItemDto, PublicWatchlistItemDto, PublicRatingDto, PublicContinueWatchingItemDto, PublicPageDto } from '../../http/contracts/account-public.js';
import type { AuthActor } from '../auth/auth.types.js';
import { WatchQueryService } from '../watch/watch-query.service.js';
import { PublicAccountAccessService } from './public-account-access.service.js';
import { mapPublicWatchItem, mapPublicWatchlistItem, mapPublicRatingItem, mapPublicContinueWatchingItem } from './public-watch.mappers.js';

export class PublicWatchReadService {
  constructor(
    private readonly accessService = new PublicAccountAccessService(),
    private readonly watchQueryService = new WatchQueryService(),
  ) {}

  async listRecentWatched(actor: AuthActor, profileId: string, limit: number): Promise<PublicWatchItemDto[]> {
    this.accessService.requireScope(actor, 'watch:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      const rows = await this.watchQueryService.listWatchHistory(client, profileId, Math.min(limit, 50));
      return rows
        .map((row) => mapPublicWatchItem(row, profileId))
        .filter((item): item is PublicWatchItemDto => item !== null);
    });
  }

  async listHistory(
    actor: AuthActor,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PublicPageDto<PublicWatchItemDto>> {
    this.accessService.requireScope(actor, 'watch:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      const page = await this.watchQueryService.listWatchHistoryPage(client, profileId, params);
      return {
        items: page.items
          .map((row) => mapPublicWatchItem(row, profileId))
          .filter((item): item is PublicWatchItemDto => item !== null),
        page: {
          limit: params.limit,
          nextCursor: page.pageInfo.nextCursor,
        },
      };
    });
  }

  async listWatchlist(
    actor: AuthActor,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PublicPageDto<PublicWatchlistItemDto>> {
    this.accessService.requireScope(actor, 'watch:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      const page = await this.watchQueryService.listWatchlistPage(client, profileId, params);
      return {
        items: page.items
          .map((row) => mapPublicWatchlistItem(row, profileId))
          .filter((item): item is PublicWatchlistItemDto => item !== null),
        page: {
          limit: params.limit,
          nextCursor: page.pageInfo.nextCursor,
        },
      };
    });
  }

  async listRatings(
    actor: AuthActor,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PublicPageDto<PublicRatingDto>> {
    this.accessService.requireScope(actor, 'watch:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      const page = await this.watchQueryService.listRatingsPage(client, profileId, params);
      return {
        items: page.items
          .map((row) => mapPublicRatingItem(row, profileId))
          .filter((item): item is PublicRatingDto => item !== null),
        page: {
          limit: params.limit,
          nextCursor: page.pageInfo.nextCursor,
        },
      };
    });
  }

  async listContinueWatching(
    actor: AuthActor,
    profileId: string,
    params: { limit: number; cursor?: string | null },
  ): Promise<PublicPageDto<PublicContinueWatchingItemDto>> {
    this.accessService.requireScope(actor, 'watch:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      const page = await this.watchQueryService.listContinueWatchingPage(client, profileId, params);
      return {
        items: page.items
          .map((row) => mapPublicContinueWatchingItem(row, profileId))
          .filter((item): item is PublicContinueWatchingItemDto => item !== null),
        page: {
          limit: params.limit,
          nextCursor: page.pageInfo.nextCursor,
        },
      };
    });
  }
}
