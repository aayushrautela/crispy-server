import type { ClientImages, ClientParentRef, ClientProviderIds } from '../recommendations/client-home.types.js';

export const CALENDAR_BUCKETS = [
  'up_next',
  'this_week',
  'upcoming',
  'recently_released',
  'no_scheduled',
] as const;

export type CalendarBucket = (typeof CALENDAR_BUCKETS)[number];

/**
 * Calendar entries are standardized enriched episode cards: the same
 * `ClientMediaCard` shape used by watch/recommendation surfaces, extended with
 * the calendar-specific `airDate` and `bucket` fields.
 */
export type CalendarItemDto = {
  itemId: string;
  mediaType: 'episode';
  title: string;
  overview: string | null;
  year: number | null;
  releaseDate: string | null;
  rating: number | null;
  maturityRating: string | null;
  genres: string[];
  runtimeSeconds: number | null;
  images: ClientImages;
  trailerUrl: string | null;
  progress: null;
  parent: ClientParentRef | null;
  providerIds: ClientProviderIds | null;
  airDate: string | null;
  bucket: CalendarBucket;
};

export type CalendarResponse = {
  profileId: string;
  source: 'canonical_calendar';
  generatedAt: string;
  items: CalendarItemDto[];
};
