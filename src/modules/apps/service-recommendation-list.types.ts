import type { RecommendationListWriteResult } from '../recommendations/recommendation-list.types.js';
import type { RecoLayout, RecoModelInfo, RecoProvider, RecoWriteItem } from '../recommendations/reco-contract.types.js';

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

export type ServiceRecommendationItemType = 'movie' | 'tv' | 'season' | 'episode';
export type ServiceRecommendationProvider = RecoProvider;
export type ServiceRecommendationWriteItem = RecoWriteItem;

export interface UpsertServiceRecommendationListRequest {
  title: string;
  subtitle: string | null;
  layout: RecoLayout;
  items: ServiceRecommendationWriteItem[];
  model: RecoModelInfo | null;
  context: Record<string, unknown>;
}

export interface BatchUpsertServiceRecommendationListsRequest {
  profiles: Array<{
    accountId: string;
    profileId: string;
    lists: Array<UpsertServiceRecommendationListRequest & { listKey: string }>;
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
