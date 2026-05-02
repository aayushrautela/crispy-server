import type { ServiceRecommendationListDescriptor } from './service-recommendation-list.types.js';

export const OFFICIAL_RECOMMENDER_APP_ID = 'official-recommender';
export const OFFICIAL_RECOMMENDER_SOURCE = 'official-recommender';
export const OFFICIAL_RECOMMENDER_LIST_KEYS = ['hero', 'pills', 'folders', 'franchise-rails', 'content-rails'] as const;

export type OfficialRecommenderListKey = typeof OFFICIAL_RECOMMENDER_LIST_KEYS[number];

export function isOfficialRecommenderListKey(value: string): value is OfficialRecommenderListKey {
  return OFFICIAL_RECOMMENDER_LIST_KEYS.includes(value as OfficialRecommenderListKey);
}

export function getOfficialRecommenderListDescriptors(): ServiceRecommendationListDescriptor[] {
  return OFFICIAL_RECOMMENDER_LIST_KEYS.map((listKey) => ({
    listKey,
    displayName: listKey.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
    ownerAppId: OFFICIAL_RECOMMENDER_APP_ID,
    source: OFFICIAL_RECOMMENDER_SOURCE,
    itemType: 'content',
    maxItems: 100,
    writeMode: 'replace_versioned',
    requiresEligibilityAtWrite: true,
  }));
}
