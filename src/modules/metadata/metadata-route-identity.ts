import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';

export async function resolveTitleItemIdentity(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  itemId: string,
): Promise<MediaIdentity> {
  const identity = await contentIdentityService.resolveMediaIdentity(client, itemId);
  if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
    throw new HttpError(400, 'Title routes require a title itemId.');
  }

  return identity;
}

export async function resolveShowItemIdentity(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  itemId: string,
): Promise<MediaIdentity> {
  const identity = await resolveTitleItemIdentity(client, contentIdentityService, itemId);
  if (identity.mediaType !== 'show') {
    throw new HttpError(400, 'Season routes require a show itemId.');
  }

  return identity;
}
