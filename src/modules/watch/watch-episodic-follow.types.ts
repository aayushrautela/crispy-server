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
