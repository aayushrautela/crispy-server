export type WatchEventInput = {
  clientEventId: string;
  eventType: string;
  mediaKey?: string;
  mediaType: string;
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  title?: string | null;
  subtitle?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
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

export function sanitizeWatchEventInput(input: WatchEventInput): WatchEventInput {
  return {
    ...input,
    clientEventId: input.clientEventId.trim(),
    eventType: input.eventType.trim(),
    mediaKey: input.mediaKey?.trim() || undefined,
    mediaType: input.mediaType.trim(),
  };
}

export type WatchMutationInput = {
  mediaKey?: string;
  mediaType: string;
  tmdbId?: number | null;
  showTmdbId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  title?: string | null;
  subtitle?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  occurredAt?: string | null;
  rating?: number | null;
  payload?: Record<string, unknown>;
};

export type BufferedHeartbeatSnapshot = {
  profileId: string;
  householdId: string;
  clientEventId: string;
  eventType: string;
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  title: string | null;
  subtitle: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  bufferedAt: string;
};
