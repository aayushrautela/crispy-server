import type { MetadataCardView, MetadataView } from '../metadata/metadata.types.js';
import type { SupportedProvider } from './media-key.js';

export type WatchProgressView = {
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressPercent: number;
  status?: string;
  lastPlayedAt?: string;
};

export type ContinueWatchingStateView = {
  id: string;
  positionSeconds: number | null;
  durationSeconds: number | null;
  progressPercent: number;
  lastActivityAt: string;
};

export type WatchedStateView = {
  watchedAt: string;
};

export type WatchlistStateView = {
  addedAt: string;
};

export type RatingStateView = {
  value: number;
  ratedAt: string;
};

export type HydratedWatchItem = {
  id?: string;
  media: MetadataCardView;
  progress?: WatchProgressView;
  watchedAt?: string;
  lastActivityAt?: string;
  payload?: Record<string, unknown>;
};

export type HydratedWatchlistItem = {
  media: MetadataCardView;
  addedAt: string;
  payload?: Record<string, unknown>;
};

export type HydratedRatingItem = {
  media: MetadataCardView;
  rating: RatingStateView;
  payload?: Record<string, unknown>;
};

export type CanonicalWatchCollectionKind = 'continue-watching' | 'history' | 'watchlist' | 'ratings';

export type CanonicalWatchCollectionResponse<TItem> = {
  profileId: string;
  kind: CanonicalWatchCollectionKind;
  source: 'canonical_watch';
  generatedAt: string;
  items: TItem[];
};

export type WatchStateEnvelope = {
  profileId: string;
  source: 'canonical_watch';
  generatedAt: string;
  item: WatchStateResponse;
};

export type WatchStatesEnvelope = {
  profileId: string;
  source: 'canonical_watch';
  generatedAt: string;
  items: WatchStateResponse[];
};

export type WatchStateLookupInput = {
  mediaKey?: string;
  mediaType?: string;
  provider?: SupportedProvider | null;
  providerId?: string | null;
  parentProvider?: SupportedProvider | null;
  parentProviderId?: string | null;
  tmdbId?: number | null;
  tvdbId?: number | null;
  kitsuId?: string | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  absoluteEpisodeNumber?: number | null;
};

export type WatchStateResponse = {
  media: MetadataView;
  progress: WatchProgressView | null;
  continueWatching: ContinueWatchingStateView | null;
  watched: WatchedStateView | null;
  watchlist: WatchlistStateView | null;
  rating: RatingStateView | null;
  watchedEpisodeKeys: string[];
};

export type CalendarBucket = 'up_next' | 'this_week' | 'upcoming' | 'recently_released' | 'no_scheduled';

export type CalendarItem = {
  bucket: CalendarBucket;
  media: MetadataCardView;
  relatedShow: MetadataCardView;
  airDate: string | null;
  watched: boolean;
};

export type CalendarResponse = {
  profileId: string;
  source: 'canonical_calendar';
  generatedAt: string;
  items: CalendarItem[];
};
