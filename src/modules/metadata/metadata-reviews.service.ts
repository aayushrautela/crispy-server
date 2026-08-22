import { withDbClient } from '../../lib/db.js';
import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { resolveSeriesItemIdentity } from './metadata-route-identity.js';
import type { MetadataReviewView, MetadataTitleReviewsResponse } from './metadata-detail.types.js';
import { MetadataReviewAggregator, mergeReviews } from './metadata-review-aggregator.js';

export { mergeReviews };

export class MetadataReviewsService {
  constructor(
    private readonly reviewAggregator = new MetadataReviewAggregator(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async getTitleReviews(userId: string, profileId: string, itemId: string, language?: string | null): Promise<MetadataTitleReviewsResponse> {
    return withDbClient(async (client) => {
      const identity = await resolveSeriesItemIdentity(client, this.contentIdentityService, itemId);
      const reviews = await this.loadTitleReviews(client, userId, profileId, identity, language ?? null);
      return { Reviews: reviews };
    });
  }

  async loadTitleReviews(
    client: DbClient,
    userId: string,
    profileId: string,
    identity: MediaIdentity,
    language?: string | null,
  ): Promise<MetadataReviewView[]> {
    return this.reviewAggregator.loadTitleReviews(client, identity, language ?? null, { userId, profileId });
  }
}
