import type { RecoHomeSectionType } from '../recommendations/reco-contract.types.js';

export const OFFICIAL_RECOMMENDER_APP_ID = 'official-recommender';
export const OFFICIAL_RECOMMENDER_SOURCE = 'official-recommender';

export interface OfficialRecommendationListConfig {
  listKey: string;
  sectionType: RecoHomeSectionType;
  maxItems: number;
}

export const OFFICIAL_RECOMMENDER_LISTS: OfficialRecommendationListConfig[] = [
  { listKey: 'category-tabs', sectionType: 'categoryTabs', maxItems: 100 },
  { listKey: 'hero-carousel', sectionType: 'heroCarousel', maxItems: 10 },
  { listKey: 'content-rails', sectionType: 'contentRail', maxItems: 100 },
  { listKey: 'collection-rails', sectionType: 'collectionRail', maxItems: 100 },
];

export function getOfficialRecommendationListConfig(listKey: string): OfficialRecommendationListConfig | null {
  return OFFICIAL_RECOMMENDER_LISTS.find((list) => list.listKey === listKey) ?? null;
}
