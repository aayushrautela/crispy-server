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

export type WatchIngestMode = 'synchronous';

/**
 * Outcome of a watch mutation at the service layer. A rejected mutation
 * (accepted = false) always carries a human-readable `reason` so clients can
 * surface the server-provided explanation instead of a hardcoded fallback.
 */
export type WatchActionOutcome =
  | { accepted: true }
  | { accepted: false; reason: string };

export type WatchIngestResult = WatchActionOutcome & { mode: WatchIngestMode };

export type WatchActionResponse = {
  accepted: boolean;
  mode: WatchIngestMode;
  reason?: string;
};

export type WatchMediaProjection = {
  detailsTitleMediaType: 'movie' | 'show' | null;
  playbackMediaType: 'movie' | 'show' | 'episode' | null;
  playbackProvider: SupportedProvider | null;
  playbackProviderId: string | null;
  playbackParentProvider: SupportedProvider | null;
  playbackParentProviderId: string | null;
  playbackSeasonNumber: number | null;
  playbackEpisodeNumber: number | null;
  playbackAbsoluteEpisodeNumber: number | null;
  detailsStillUrl: string | null;
  detailsReleaseYear: number | null;
  detailsOverview: string | null;
  detailsReleaseDate: string | null;
  detailsStatus: string | null;
  detailsRuntimeMinutes: number | null;
  detailsRating: number | null;
  episodeTitle: string | null;
  episodeAirDate: string | null;
  episodeRuntimeMinutes: number | null;
  episodeStillUrl: string | null;
  title: string | null;
  subtitle: string | null;
  artworkUrl: string | null;
  logoUrl: string | null;
  trailerUrl: string | null;
  trailerThumbnailUrl: string | null;
  posterColor: string | null;
  backdropColor: string | null;
  maturityRating: string | null;
  genres: string[];
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

