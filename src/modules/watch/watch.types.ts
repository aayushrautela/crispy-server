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
