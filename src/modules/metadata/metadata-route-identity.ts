import type { DbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import type { MediaIdentity } from '../identity/media-key.js';

export async function resolveMetadataItemIdentity(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  itemId: string,
): Promise<MediaIdentity> {
  return contentIdentityService.resolveMetadataItemIdentity(client, assertPublicItemId(itemId));
}

export async function resolveSeriesItemIdentity(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  itemId: string,
): Promise<MediaIdentity> {
  return contentIdentityService.resolveSeriesItemIdentity(client, assertPublicItemId(itemId));
}
