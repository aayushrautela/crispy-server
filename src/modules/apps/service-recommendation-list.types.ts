import type { RecommendationListWriteResult } from '../recommendations/recommendation-list.types.js';

export interface ServiceRecommendationListDescriptor {
  listKey: string;
  displayName: string;
  ownerAppId: string;
  source: string;
  itemType: 'content';
  maxItems: number;
  writeMode: 'replace_versioned';
  requiresEligibilityAtWrite: boolean;
}

export interface ServiceRecommendationListsResponse {
  appId: string;
  source: string;
  lists: ServiceRecommendationListDescriptor[];
}

export type ServiceRecommendationItemType = 'movie' | 'tv';

export interface ServiceRecommendationItemRef {
  type: ServiceRecommendationItemType;
  tmdbId: number;
}

export interface UpsertServiceRecommendationListRequest {
  items: ServiceRecommendationItemRef[];
}

export interface BatchUpsertServiceRecommendationListsRequest {
  profiles: Array<{
    accountId: string;
    profileId: string;
    lists: Array<{ listKey: string; items: ServiceRecommendationItemRef[] }>;
  }>;
}

export interface BatchUpsertServiceRecommendationListsResult {
  status: 'completed' | 'completed_with_errors' | 'failed';
  summary: {
    profilesReceived: number;
    profilesWritten: number;
    profilesRejected: number;
    listsWritten: number;
    itemsWritten: number;
  };
  results: Array<ServiceRecommendationProfileWriteResult>;
  requestHash: string;
  idempotency: { key: string; replayed: boolean };
}

export interface ServiceRecommendationProfileWriteResult {
  accountId: string;
  profileId: string;
  status: 'written' | 'rejected';
  lists?: Array<{ listKey: string; source: string; version: number; itemCount: number }>;
  error?: { code: string; message: string; details?: unknown };
}

export interface UpsertServiceRecommendationListResult extends RecommendationListWriteResult {
  eligibility: { checkedAt: Date; eligible: boolean; eligibilityVersion: number };
}
