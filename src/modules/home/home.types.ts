import type { CalendarItem, HydratedWatchItem } from '../watch/watch-read.types.js';

export type HomeSectionId =
  | 'continue-watching'
  | 'up-next'
  | 'this-week'
  | 'recently-released'
  | 'recent-history';

export type HomeSection = {
  id: HomeSectionId;
  title: string;
  items: HydratedWatchItem[] | CalendarItem[];
};

export type HomeResponse = {
  sections: HomeSection[];
};
