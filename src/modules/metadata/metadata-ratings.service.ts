import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { FeatureEntitlementService } from '../entitlements/feature-entitlement.service.js';
import { MdbListClient } from '../integrations/mdblist.client.js';
import { MdbListService } from '../integrations/mdblist.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { resolveTitleRouteIdentity } from './metadata-detail.service.js';
import type { MetadataTitleRatingsResponse, MetadataView } from './metadata-detail.types.js';

type DbRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

function resolveRatingsLookup(item: MetadataView): { provider: 'tmdb' | 'imdb'; id: number | string } | null {
  if (item.externalIds.tmdb) {
    return { provider: 'tmdb', id: item.externalIds.tmdb };
  }
  if (item.externalIds.imdb) {
    return { provider: 'imdb', id: item.externalIds.imdb };
  }
  return null;
}

export class MetadataRatingsService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly entitlementService = new FeatureEntitlementService(),
    private readonly mdblistService = new MdbListService(new MdbListClient()),
    private readonly runWithDb: DbRunner = withDbClient,
  ) {}

  async getTitleRatings(userId: string, _profileId: string, mediaKey: string): Promise<MetadataTitleRatingsResponse> {
    const apiKey = await this.entitlementService.resolveMdbListApiKeyForUser(userId);
    if (!apiKey) {
      throw new HttpError(412, 'MDBList is not configured. Add your MDBList API key or set MDBLIST_API_KEY in your environment.');
    }

    return this.runWithDb(async (client) => {
      const identity = await resolveTitleRouteIdentity(client, this.contentIdentityService, mediaKey);
      if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
        throw new HttpError(400, 'Title ratings require a title mediaKey.');
      }

      const item = await this.metadataDetailCoreService.buildMetadataView(client, identity);
      const lookup = resolveRatingsLookup(item);
      if (!lookup) {
        throw new HttpError(404, 'Title ratings not available for this title.');
      }

      const mediaType = identity.mediaType === 'movie' ? 'movie' : 'show';
      const ratings = await this.mdblistService.getTitleRatings(apiKey, mediaType, lookup);
      if (!ratings) {
        throw new HttpError(404, 'MDBList ratings not found for this title.');
      }

      return ratings;
    });
  }
}
