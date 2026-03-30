export type {
  SupportedProvider,
  SupportedMediaType,
  CanonicalContentEntityType,
  MediaIdentity,
} from './media-key.js';

export {
  ensureSupportedMediaType,
  ensureSupportedProvider,
  authorityProviderForEntityType,
  authorityProviderForMediaType,
  showTmdbIdForIdentity,
  canonicalContinueWatchingMediaKey,
  parseMediaKey,
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  buildSeasonProviderId,
  buildEpisodeProviderId,
  buildAbsoluteEpisodeProviderId,
} from './media-key.js';

export { ContentIdentityService } from './content-identity.service.js';

export type {
  CanonicalContentReference,
  TitleIdentityInput,
  EpisodeIdentityInput,
  SeasonIdentityInput,
} from './content-identity.service.js';

export { titleRefMapKey, episodeRefMapKey } from './content-identity.service.js';

export { ContentIdentityRepository } from './content-identity.repo.js';

export type {
  ContentEntityType,
  ContentProviderRefInput,
  ContentProviderRefRecord,
  ContentItemRecord,
} from './content-identity.repo.js';
