import { normalizeOptionalIsoString } from '../../lib/time.js';
import type { SupportedProvider } from '../identity/media-key.js';

export type WatchEventInput = {
  clientEventId: string;
  eventType: string;
  mediaKey?: string;
  mediaType: string;
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
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  rating?: number | null;
  occurredAt?: string | null;
  payload?: Record<string, unknown>;
};

export type WatchIngestMode = 'synchronous' | 'buffered' | 'sync_fallback';

export type WatchIngestResult = {
  accepted: true;
  mode: WatchIngestMode;
};

export type WatchMediaProjection = {
  detailsTitleId: string | null;
  detailsTitleMediaType: 'movie' | 'show' | 'anime' | null;
  highlightEpisodeId: string | null;
  playbackContentId: string | null;
  playbackMediaType: 'movie' | 'show' | 'episode' | 'anime' | null;
  playbackProvider: SupportedProvider | null;
  playbackProviderId: string | null;
  playbackParentProvider: SupportedProvider | null;
  playbackParentProviderId: string | null;
  playbackSeasonNumber: number | null;
  playbackEpisodeNumber: number | null;
  playbackAbsoluteEpisodeNumber: number | null;
  detailsTitle: string | null;
  detailsSubtitle: string | null;
  detailsSummary: string | null;
  detailsOverview: string | null;
  detailsPosterUrl: string | null;
  detailsBackdropUrl: string | null;
  detailsStillUrl: string | null;
  detailsReleaseDate: string | null;
  detailsReleaseYear: number | null;
  detailsRuntimeMinutes: number | null;
  detailsRating: number | null;
  detailsStatus: string | null;
  detailsProvider: SupportedProvider | null;
  detailsProviderId: string | null;
  detailsParentProvider: SupportedProvider | null;
  detailsParentProviderId: string | null;
  detailsTmdbId: number | null;
  detailsShowTmdbId: number | null;
  episodeTitle: string | null;
  episodeAirDate: string | null;
  episodeRuntimeMinutes: number | null;
  episodeStillUrl: string | null;
  episodeOverview: string | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
};

export function sanitizeWatchEventInput(input: WatchEventInput): WatchEventInput {
  return {
    ...input,
    clientEventId: input.clientEventId.trim(),
    eventType: input.eventType.trim(),
    mediaKey: input.mediaKey?.trim() || undefined,
    mediaType: input.mediaType.trim(),
    occurredAt: normalizeOptionalIsoString(input.occurredAt, 'occurredAt'),
  };
}

export function normalizeWatchOccurredAt(value: Date | string | null | undefined, fieldName = 'occurredAt'): string {
  return normalizeOptionalIsoString(value, fieldName) ?? new Date().toISOString();
}

export type WatchMutationInput = {
  mediaKey?: string;
  mediaType: string;
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
  occurredAt?: string | null;
  rating?: number | null;
  payload?: Record<string, unknown>;
};

export type BufferedHeartbeatSnapshot = {
  profileId: string;
  profileGroupId: string;
  clientEventId: string;
  eventType: string;
  mediaKey: string;
  mediaType: string;
  provider: SupportedProvider | null;
  providerId: string | null;
  parentProvider: SupportedProvider | null;
  parentProviderId: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
  kitsuId: string | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  bufferedAt: string;
};
