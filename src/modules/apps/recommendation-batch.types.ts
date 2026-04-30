import type { AppPrincipal } from './app-principal.types.js';

export type RecommendationBatchStatus = 'leased' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface CreateRecommendationBatchRequest {
  snapshotId?: string;
  items?: Array<{ snapshotItemId?: string; accountId: string; profileId: string }>;
  leaseSeconds?: number;
}

export interface UpdateRecommendationBatchRequest {
  status?: RecommendationBatchStatus;
  progress?: { profilesCompleted?: number; profilesFailed?: number; listsWritten?: number };
  errors?: Array<{ accountId?: string; profileId?: string; code: string; message: string }>;
}

export interface RecommendationBatch {
  batchId: string;
  runId: string;
  appId: string;
  status: RecommendationBatchStatus;
  snapshotId?: string | null;
  lease?: { leaseId: string; expiresAt: Date } | null;
  itemCount: number;
  progress?: Record<string, number>;
  errors?: Array<Record<string, unknown>>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecommendationBatchInput {
  principal: AppPrincipal;
  runId: string;
  request: CreateRecommendationBatchRequest;
}

export interface UpdateRecommendationBatchInput {
  principal: AppPrincipal;
  runId: string;
  batchId: string;
  request: UpdateRecommendationBatchRequest;
}
