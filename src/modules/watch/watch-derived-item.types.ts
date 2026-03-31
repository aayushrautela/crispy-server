import type { SupportedProvider } from '../identity/media-key.js';
import type { MetadataCardView, MetadataTitleMediaType, MetadataViewMediaType } from '../metadata/metadata.types.js';
import type { WatchProgressView } from './watch-state.types.js';

export type DetailsTarget = {
  kind: 'title';
  titleId: string;
  titleMediaType: MetadataTitleMediaType;
  highlightEpisodeId: string | null;
};

export type PlaybackTarget = {
  contentId: string | null;
  mediaType: MetadataViewMediaType;
  provider: SupportedProvider | null;
  providerId: string | null;
  parentProvider: SupportedProvider | null;
  parentProviderId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
};

export type EpisodeContext = {
  episodeId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  title: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  stillUrl: string | null;
  overview: string | null;
} | null;

export type WatchDerivedProductItem = {
  media: MetadataCardView;
  detailsTarget: DetailsTarget;
  playbackTarget: PlaybackTarget | null;
  episodeContext: EpisodeContext;
};

export type ContinueWatchingProductItem = WatchDerivedProductItem & {
  id: string;
  progress: WatchProgressView;
  lastActivityAt: string;
  origins: string[];
  dismissible: boolean;
};

export type WatchedProductItem = WatchDerivedProductItem & {
  watchedAt: string;
  origins: string[];
};

export type WatchlistProductItem = WatchDerivedProductItem & {
  addedAt: string;
  origins: string[];
};

export type RatingProductItem = WatchDerivedProductItem & {
  rating: { value: number; ratedAt: string };
  origins: string[];
};
