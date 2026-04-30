import type { AppPrincipal } from './app-principal.types.js';

export type EligibleProfileSnapshotStatus = 'draft' | 'pending_approval' | 'active' | 'paused' | 'cancelled' | 'completed' | 'expired';
export type EligibleProfileSnapshotItemStatus = 'pending' | 'leased' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'expired';

export interface CreateEligibleProfileSnapshotRequest {
  purpose: 'recommendation-generation';
  filters?: {
    accountIds?: string[];
    profileIds?: string[];
    languages?: string[];
    minSignalsVersion?: number;
    includeProfilesWithNoPriorRecommendations?: boolean;
  };
  reason: string;
  requestedBy?: { type: 'admin' | 'system'; id: string };
}

export interface EligibleProfileSnapshot {
  snapshotId: string;
  appId: string;
  purpose: 'recommendation-generation';
  status: EligibleProfileSnapshotStatus;
  filters: Record<string, unknown>;
  estimatedProfileCount: number;
  createdAt: Date;
  approvedBy?: string | null;
  approvedAt?: Date | null;
}

export interface EligibleProfileSnapshotItem {
  snapshotItemId: string;
  snapshotId: string;
  accountId: string;
  profileId: string;
  eligibilityVersion: number;
  signalsVersion: number;
  status: EligibleProfileSnapshotItemStatus;
  lease?: { leaseId: string; expiresAt: Date };
}

export interface CreateEligibleProfileSnapshotInput {
  appId: string;
  purpose: string;
  status: EligibleProfileSnapshotStatus;
  filters: Record<string, unknown>;
  reason: string;
  requestedBy?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CountEligibleProfilesForSnapshotInput {
  appId: string;
  purpose: string;
  filters: Record<string, unknown>;
}

export interface EligibleProfileSnapshotService {
  createSnapshot(input: {
    principal: AppPrincipal;
    request: CreateEligibleProfileSnapshotRequest;
  }): Promise<{ snapshot: EligibleProfileSnapshot }>;

  listItems(input: {
    principal: AppPrincipal;
    snapshotId: string;
    cursor?: string;
    limit?: number;
    leaseSeconds?: number;
  }): Promise<{
    snapshot: EligibleProfileSnapshot;
    items: EligibleProfileSnapshotItem[];
    cursor: { next?: string | null; hasMore: boolean };
  }>;
}
