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
  canonicalTitleMediaKey,
  canonicalTitleMediaType,
  isTitleLevelMediaType,
  isPlayableMediaType,
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

export {
  encodePublicItemId,
  decodePublicItemId,
  assertPublicItemId,
} from './public-item-id.js';

export type {
  ContentEntityType,
  ContentProviderRefInput,
  ContentProviderRefRecord,
  ContentItemRecord,
  ContentRelationshipType,
  ContentRelationshipInput,
  ContentRelationshipRecord,
} from './content-identity.repo.js';
