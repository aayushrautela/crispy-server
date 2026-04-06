import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import { MdbListClient } from '../integrations/mdblist.client.js';
import { MdbListService } from '../integrations/mdblist.service.js';
import type { MdbContentView, MetadataView } from './metadata-detail.types.js';

export class MetadataEnrichmentService {
  constructor(
    private readonly entitlementService = new FeatureEntitlementService(),
    private readonly mdblistService = new MdbListService(new MdbListClient()),
  ) {}

  async getTitleContent(userId: string, item: MetadataView): Promise<MdbContentView> {
    const apiKey = await this.entitlementService.resolveMdbListApiKeyForUser(userId);
    if (!apiKey) {
      throw new HttpError(412, 'MDBList is not configured. Add your MDBList API key or set MDBLIST_API_KEY in your environment.');
    }

    const tmdbId = item.externalIds.tmdb;
    if (!tmdbId) {
      throw new HttpError(404, 'Title metadata not available for content lookup.');
    }

    const mediaType = item.mediaType === 'movie' ? 'movie' : 'show';
    const content = await this.mdblistService.getTitle(apiKey, mediaType, tmdbId);
    if (!content) {
      throw new HttpError(404, 'MDBList content not found for this title.');
    }

    return content;
  }
}
