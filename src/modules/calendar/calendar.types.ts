import type { BaseItemDto } from '../metadata/media-item.types.js';

export type CalendarResponse = {
  profileId: string;
  source: 'canonical_calendar';
  generatedAt: string;
  items: BaseItemDto[];
};
