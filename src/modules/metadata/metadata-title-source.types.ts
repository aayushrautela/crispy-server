import type { MediaIdentity } from '../identity/media-key.js';
import type { ProviderIdentityContext } from './provider-metadata.service.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord } from './providers/tmdb.types.js';

export type MetadataTitleSourceSnapshot = {
  identity: MediaIdentity;
  language: string | null;
  providerIdentity: MediaIdentity | null;
  providerContext: ProviderIdentityContext | null;
  tmdbTitle: TmdbTitleRecord | null;
  tmdbNextEpisode: TmdbEpisodeRecord | null;
};
