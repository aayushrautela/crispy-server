import type { BaseItemDto } from '../metadata/media-item.types.js';

export const CALENDAR_BUCKETS = [
  'up_next',
  'this_week',
  'upcoming',
  'recently_released',
  'no_scheduled',
] as const;

export type CalendarBucket = (typeof CALENDAR_BUCKETS)[number];

export type CalendarItemDto = BaseItemDto & { bucket: CalendarBucket };

export type CalendarResponse = {
  profileId: string;
  source: 'canonical_calendar';
  generatedAt: string;
  items: CalendarItemDto[];
};
