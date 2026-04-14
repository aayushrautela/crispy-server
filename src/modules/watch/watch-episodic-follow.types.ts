import type { MetadataCardView } from '../metadata/metadata-card.types.js';

export type CanonicalNextEpisodeRef = {
  mediaKey: string;
  airDate: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  title: string | null;
};

export type EpisodicFollowStateInput = {
  profileId: string;
  titleContentId: string;
  titleMediaKey: string;
  nextEpisode: CanonicalNextEpisodeRef | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown>;
};

export type EpisodicFollowView = {
  show: MetadataCardView;
  reason: string | null;
  lastInteractedAt: string;
  nextEpisodeAirDate: string | null;
  nextEpisodeMediaKey: string | null;
  nextEpisodeSeasonNumber: number | null;
  nextEpisodeEpisodeNumber: number | null;
  nextEpisodeAbsoluteEpisodeNumber: number | null;
  nextEpisodeTitle: string | null;
  metadataRefreshedAt: string | null;
  payload: Record<string, unknown>;
};
