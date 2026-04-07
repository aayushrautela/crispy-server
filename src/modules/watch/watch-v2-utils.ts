import type { DbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import {
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  showTmdbIdForIdentity,
  type MediaIdentity,
} from '../identity/media-key.js';

const CONTINUE_WATCHING_V2_PREFIX = 'cw2:';

export type ResolvedWatchV2Lookup = {
  contentId: string;
  titleContentId: string;
  titleIdentity: MediaIdentity;
};

export function encodeWatchV2ContinueWatchingId(titleContentId: string): string {
  return `${CONTINUE_WATCHING_V2_PREFIX}${titleContentId}`;
}

export function decodeWatchV2ContinueWatchingId(value: string): string | null {
  return value.startsWith(CONTINUE_WATCHING_V2_PREFIX)
    ? value.slice(CONTINUE_WATCHING_V2_PREFIX.length) || null
    : null;
}

export async function resolveWatchV2Lookup(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  identity: MediaIdentity,
): Promise<ResolvedWatchV2Lookup> {
  const contentId = await contentIdentityService.ensureContentId(client, identity);
  if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return {
      contentId,
      titleContentId: contentId,
      titleIdentity: inferMediaIdentity({
        ...identity,
        contentId,
        mediaType: identity.mediaType,
        provider: identity.provider,
        providerId: identity.providerId,
      }),
    };
  }

  const titleProvider = identity.parentProvider ?? identity.provider;
  const titleProviderId = identity.parentProviderId ?? identity.providerId ?? identity.mediaKey;
  const titleTmdbId = parentMediaTypeForIdentity(identity) === 'show' ? showTmdbIdForIdentity(identity) : null;
  const titleIdentity = inferMediaIdentity({
    contentId: identity.parentContentId,
    mediaType: parentMediaTypeForIdentity(identity),
    provider: titleProvider,
    providerId: titleProviderId,
    providerMetadata: titleTmdbId ? { tmdbId: titleTmdbId, showTmdbId: titleTmdbId } : undefined,
  });
  const titleContentId = await contentIdentityService.ensureContentId(client, titleIdentity);
  return {
    contentId,
    titleContentId,
    titleIdentity,
  };
}

export function toEpisodicSeriesIdentity(identity: MediaIdentity): MediaIdentity | null {
  if (identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return identity;
  }

  if ((identity.mediaType === 'season' || identity.mediaType === 'episode') && identity.parentProvider && identity.parentProviderId) {
    const titleTmdbId = parentMediaTypeForIdentity(identity) === 'show' ? showTmdbIdForIdentity(identity) : null;
    return inferMediaIdentity({
      contentId: identity.parentContentId,
      mediaType: parentMediaTypeForIdentity(identity),
      provider: identity.parentProvider,
      providerId: identity.parentProviderId,
      providerMetadata: titleTmdbId ? { tmdbId: titleTmdbId, showTmdbId: titleTmdbId } : undefined,
    });
  }

  return null;
}
