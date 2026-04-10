import { inferMediaIdentity, parentMediaTypeForIdentity, type MediaIdentity } from '../identity/media-key.js';

export function normalizeProviderTitleIdentity(identity: MediaIdentity): MediaIdentity | null {
  if (identity.mediaType === 'show' || identity.mediaType === 'anime') {
    return identity.provider === 'tvdb' || identity.provider === 'kitsu' ? identity : null;
  }

  if ((identity.mediaType === 'episode' || identity.mediaType === 'season') && identity.parentProvider && identity.parentProviderId) {
    if (identity.parentProvider !== 'tvdb' && identity.parentProvider !== 'kitsu') {
      return null;
    }

    const mediaType = parentMediaTypeForIdentity(identity);
    if (mediaType !== 'show' && mediaType !== 'anime') {
      return null;
    }

    return inferMediaIdentity({
      mediaType,
      provider: identity.parentProvider,
      providerId: identity.parentProviderId,
      parentContentId: identity.parentContentId ?? null,
    });
  }

  return null;
}
