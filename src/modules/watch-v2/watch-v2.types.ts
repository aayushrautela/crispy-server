import type { SupportedMediaType, SupportedProvider } from '../identity/media-key.js';

export type WatchV2SourceKind = 'local' | 'trakt_pull' | 'system';

export type WatchV2PlayableStatus = 'idle' | 'in_progress' | 'completed' | 'dismissed';

export type WatchV2TitleKind = 'movie' | 'show' | 'anime';

export type WatchV2TargetKind = WatchV2TitleKind | 'episode';

export type WatchV2ProjectionRecord = {
  profileId: string;
  titleContentId: string;
  titleKind: WatchV2TitleKind;
  titleMediaKey: string;
  titleMediaType: WatchV2TitleKind;
  titleProvider: SupportedProvider;
  titleProviderId: string;
  titleText: string | null;
  titleSubtitle: string | null;
  titlePosterUrl: string | null;
  titleBackdropUrl: string | null;
  titleReleaseYear: number | null;
  titleRuntimeMinutes: number | null;
  titleRating: number | null;
  titleContentReleaseAt: string | null;
  activeContentId: string | null;
  activeMediaKey: string | null;
  activeMediaType: Extract<SupportedMediaType, 'movie' | 'episode'> | null;
  activeProvider: SupportedProvider | null;
  activeProviderId: string | null;
  activeParentProvider: SupportedProvider | null;
  activeParentProviderId: string | null;
  activeSeasonNumber: number | null;
  activeEpisodeNumber: number | null;
  activeEpisodeTitle: string | null;
  activeEpisodeReleaseAt: string | null;
  activePositionSeconds: number | null;
  activeDurationSeconds: number | null;
  activeProgressPercent: number | null;
  hasInProgress: boolean;
  effectiveWatched: boolean;
  lastCompletedAt: string | null;
  lastWatchedAt: string | null;
  watchlistPresent: boolean;
  watchlistUpdatedAt: string | null;
  ratingValue: number | null;
  ratedAt: string | null;
  dismissedAt: string | null;
  lastActivityAt: string | null;
  updatedAt: string;
};

export type WatchV2StateRecord = {
  profileId: string;
  contentId: string;
  titleContentId: string;
  playbackStatus: WatchV2PlayableStatus;
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number;
  playCount: number;
  firstCompletedAt: string | null;
  lastCompletedAt: string | null;
  lastActivityAt: string;
  dismissedAt: string | null;
  lastMutationSeq: number;
  sourceKind: WatchV2SourceKind;
  sourceUpdatedAt: string;
  updatedAt: string;
};

export type WatchV2OverrideState = 'watched' | 'unwatched';

export type WatchV2OverrideRecord = {
  profileId: string;
  targetContentId: string;
  targetKind: WatchV2TargetKind;
  overrideState: WatchV2OverrideState;
  scope: 'self' | 'released_descendants';
  appliesThroughReleaseAt: string | null;
  lastMutationSeq: number;
  sourceKind: WatchV2SourceKind;
  sourceUpdatedAt: string;
  updatedAt: string;
};

export type WatchV2WatchlistRecord = {
  profileId: string;
  targetContentId: string;
  targetKind: WatchV2TitleKind;
  present: boolean;
  addedAt: string | null;
  removedAt: string | null;
  lastMutationSeq: number;
  sourceKind: WatchV2SourceKind;
  sourceUpdatedAt: string;
  updatedAt: string;
};

export type WatchV2RatingRecord = {
  profileId: string;
  targetContentId: string;
  targetKind: WatchV2TitleKind;
  rating: number | null;
  ratedAt: string | null;
  removedAt: string | null;
  lastMutationSeq: number;
  sourceKind: WatchV2SourceKind;
  sourceUpdatedAt: string;
  updatedAt: string;
};

export type WatchV2TitleIdentity = {
  contentId: string;
  mediaKey: string;
  mediaType: WatchV2TitleKind;
  provider: SupportedProvider;
  providerId: string;
};

export type WatchV2ResolvedTarget = {
  contentId: string;
  titleContentId: string;
  mediaKey: string;
  mediaType: WatchV2TargetKind;
  provider: SupportedProvider;
  providerId: string;
  parentProvider: SupportedProvider | null;
  parentProviderId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  releaseAt: string | null;
  title: WatchV2TitleIdentity;
};
