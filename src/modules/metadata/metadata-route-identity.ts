import type { DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { parseMediaKey } from '../identity/media-key.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';

export async function resolveTitleRouteIdentity(
  _client: DbClient,
  _contentIdentityService: ContentIdentityService,
  mediaKey: string,
): Promise<MediaIdentity> {
  const identity = parseMediaKey(mediaKey.trim());
  if (identity.mediaType !== 'movie' && identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
    throw new HttpError(400, 'Title routes require a title mediaKey.');
  }

  return identity;
}

export async function resolveShowRouteIdentity(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  mediaKey: string,
): Promise<MediaIdentity> {
  const identity = await resolveTitleRouteIdentity(client, contentIdentityService, mediaKey);
  if (identity.mediaType !== 'show' && identity.mediaType !== 'anime') {
    throw new HttpError(400, 'Season routes require a show or anime mediaKey.');
  }

  return identity;
}
