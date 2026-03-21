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
