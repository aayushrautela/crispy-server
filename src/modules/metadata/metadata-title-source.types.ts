import type { MediaIdentity } from '../identity/media-key.js';
import type { TmdbEpisodeRecord, TmdbSeasonRecord, TmdbTitleRecord } from './providers/tmdb.types.js';

export type MetadataTitleSourceSnapshot = {
  identity: MediaIdentity;
  language: string | null;
  tmdbTitle: TmdbTitleRecord | null;
  tmdbCurrentEpisode: TmdbEpisodeRecord | null;
  tmdbCurrentSeason: TmdbSeasonRecord | null;
  tmdbNextEpisode: TmdbEpisodeRecord | null;
};
