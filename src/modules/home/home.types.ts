import type { CalendarItem } from '../watch/watch-read.types.js';
import type { ContinueWatchingProductItem, WatchedProductItem } from '../watch/watch-derived-item.types.js';
import type { RecommendationSectionItem } from '../recommendations/recommendation.types.js';

export type HomeSectionId =
  | 'continue-watching'
  | 'up-next'
  | 'this-week'
  | 'recently-released'
  | 'recent-history'
  | string;

export type HomeSectionKind = 'watch' | 'calendar' | 'recommendation';

export type HomeWatchSection = {
  id: HomeSectionId;
  title: string;
  kind: 'watch';
  source: 'canonical_watch';
  items: ContinueWatchingProductItem[] | WatchedProductItem[];
};

export type HomeCalendarSection = {
  id: HomeSectionId;
  title: string;
  kind: 'calendar';
  source: 'canonical_calendar';
  items: CalendarItem[];
};

export type HomeRecommendationSection = {
  id: HomeSectionId;
  title: string;
  kind: 'recommendation';
  source: 'recommendation';
  items: RecommendationSectionItem[];
  meta: Record<string, unknown>;
};

export type HomeSection = HomeWatchSection | HomeCalendarSection | HomeRecommendationSection;

export type HomeResponse = {
  profileId: string;
  source: 'canonical_home';
  generatedAt: string;
  sections: HomeSection[];
};
