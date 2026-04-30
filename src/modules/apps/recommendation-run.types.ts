import type { AppPrincipal } from './app-principal.types.js';

export type RecommendationRunType = 'incremental' | 'snapshot' | 'backfill' | 'full_refresh';
export type RecommendationRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface CreateRecommendationRunRequest {
  purpose: 'recommendation-generation';
  runType: RecommendationRunType;
  modelVersion?: string;
  algorithm?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateRecommendationRunRequest {
  status?: RecommendationRunStatus;
  progress?: RecommendationRunProgress;
  output?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface RecommendationRunProgress {
  profilesScanned?: number;
  profilesGenerated?: number;
  profilesSkipped?: number;
  profilesFailed?: number;
  listsWritten?: number;
}

export interface RecommendationRun {
  runId: string;
  appId: string;
  purpose: 'recommendation-generation';
  runType: RecommendationRunType;
  status: RecommendationRunStatus;
  modelVersion?: string | null;
  algorithm?: string | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  progress: RecommendationRunProgress;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}

export interface CreateRecommendationRunInput {
  principal: AppPrincipal;
  request: CreateRecommendationRunRequest;
}

export interface UpdateRecommendationRunInput {
  principal: AppPrincipal;
  runId: string;
  request: UpdateRecommendationRunRequest;
}
