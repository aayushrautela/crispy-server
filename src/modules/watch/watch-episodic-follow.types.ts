export type CanonicalNextEpisodeRef = {
  itemId: string;
  airDate: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
};

export type EpisodicFollowInternal = {
  showItemId: string;
  reason: string | null;
  lastInteractedAt: string;
  nextEpisode: CanonicalNextEpisodeRef;
};
