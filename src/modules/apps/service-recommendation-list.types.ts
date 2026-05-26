import type { RecommendationListWriteResult } from '../recommendations/recommendation-list.types.js';
import type { RecoHomeSectionType, RecoModelInfo, RecoWriteItem } from '../recommendations/reco-contract.types.js';

export interface UpsertServiceRecommendationListRequest {
  title: string;
  subtitle: string | null;
  sectionType: RecoHomeSectionType;
  items: RecoWriteItem[];
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
