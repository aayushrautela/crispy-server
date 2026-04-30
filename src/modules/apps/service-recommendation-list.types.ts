import type { RecommendationListItemInput, RecommendationListWriteResult } from '../recommendations/recommendation-list.types.js';

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

export interface UpsertServiceRecommendationListRequest {
  purpose: 'recommendation-generation';
  runId?: string;
  input: {
    eligibilityVersion: number;
    signalsVersion: number;
    modelVersion?: string;
    algorithm?: string;
  };
  writeMode: 'replace';
  items: RecommendationListItemInput[];
}

export interface BatchUpsertServiceRecommendationListsRequest {
  purpose: 'recommendation-generation';
  runId?: string;
  batchId?: string;
  writeMode: 'replace';
  profiles: Array<{
    accountId: string;
    profileId: string;
    eligibilityVersion: number;
    signalsVersion: number;
    lists: Array<{ listKey: string; items: RecommendationListItemInput[] }>;
  }>;
}

export interface BatchUpsertServiceRecommendationListsResult {
  runId?: string;
  batchId?: string;
  status: 'completed' | 'completed_with_errors' | 'failed';
  summary: {
    profilesReceived: number;
    profilesWritten: number;
    profilesRejected: number;
    listsWritten: number;
    itemsWritten: number;
  };
  results: Array<ServiceRecommendationProfileWriteResult>;
  idempotency: { key: string; replayed: boolean };
}

export interface ServiceRecommendationProfileWriteResult {
  accountId: string;
  profileId: string;
  status: 'written' | 'rejected';
  lists?: Array<{ listKey: string; source: string; version: number; itemCount: number }>;
  error?: { code: string; message: string };
}

export interface UpsertServiceRecommendationListResult extends RecommendationListWriteResult {
  eligibility: { checkedAt: Date; eligible: boolean; eligibilityVersion: number };
}
