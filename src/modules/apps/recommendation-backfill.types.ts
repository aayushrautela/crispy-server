import type { AppPrincipal } from './app-principal.types.js';

export type RecommendationBackfillAssignmentStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'expired';

export interface BackfillAssignmentsQuery {
  status?: RecommendationBackfillAssignmentStatus;
  limit?: number;
  cursor?: string;
}

export interface RecommendationBackfillAssignment {
  assignmentId: string;
  appId: string;
  snapshotId: string;
  status: RecommendationBackfillAssignmentStatus;
  priority: number;
  estimatedProfileCount: number;
  profilesCompleted: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
}

export interface BackfillAssignmentsResponse {
  assignments: RecommendationBackfillAssignment[];
  cursor: { next?: string | null; hasMore: boolean };
}

export interface GetBackfillAssignmentsInput {
  principal: AppPrincipal;
  query: BackfillAssignmentsQuery;
}
