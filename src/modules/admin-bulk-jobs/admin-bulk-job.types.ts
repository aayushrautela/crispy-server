export type AdminBulkJobOperation = 'recommendation_recompute';
export type AdminBulkJobScopeType = 'explicit_targets' | 'all_users' | 'tier';
export type AdminBulkJobStatus = 'queued' | 'enumerating' | 'fanout' | 'paused' | 'canceling' | 'canceled' | 'completed' | 'failed';
export type AdminBulkJobTargetStatus = 'queued' | 'coalesced' | 'outboxed' | 'dispatched' | 'failed' | 'canceled';
export type AdminBulkJobTier = 'free' | 'pro' | 'ultra';
export type AdminBulkJobEventType = 'created' | 'previewed' | 'coalesced' | 'enumeration_started' | 'target_enumerated' | 'enumeration_completed' | 'fanout_started' | 'target_outboxed' | 'target_coalesced' | 'fanout_completed' | 'paused' | 'resumed' | 'cancel_requested' | 'canceled' | 'failed' | 'completed';

export type AdminBulkJobScope =
  | { type: 'explicit_targets' }
  | { type: 'all_users' }
  | { type: 'tier'; tier: AdminBulkJobTier };

export type AdminBulkJobTargetInput = {
  accountId: string;
  profileId: string;
};

export type AdminBulkJobRecord = {
  id: string;
  operation: AdminBulkJobOperation;
  scopeType: AdminBulkJobScopeType;
  tier: AdminBulkJobTier | null;
  status: AdminBulkJobStatus;
  requestedByAdminId: string | null;
  requestCorrelationId: string | null;
  dedupeKey: string;
  idempotencyKey: string | null;
  reason: string | null;
  targetCountEstimate: number | null;
  targetsTotal: number;
  targetsQueued: number;
  targetsCoalesced: number;
  targetsOutboxed: number;
  targetsDispatched: number;
  targetsFailed: number;
  targetsCanceled: number;
  enumerationCursor: string | null;
  fanoutCursor: string | null;
  pauseRequestedAt: string | null;
  resumeRequestedAt: string | null;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  enumerationCompletedAt: string | null;
  fanoutCompletedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastError: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminBulkJobTargetRecord = {
  id: string;
  bulkJobId: string;
  accountId: string;
  profileId: string;
  targetKey: string;
  status: AdminBulkJobTargetStatus;
  idempotencyKey: string;
  serviceOutboxId: string | null;
  coalescedWithOutboxId: string | null;
  attemptCount: number;
  lastError: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  outboxedAt: string | null;
  terminalAt: string | null;
};

export type AdminBulkJobEventRecord = {
  id: string;
  bulkJobId: string;
  bulkJobTargetId: string | null;
  eventType: AdminBulkJobEventType;
  message: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateAdminBulkJobInput = {
  scope: AdminBulkJobScope;
  targets: AdminBulkJobTargetInput[];
  reason: string | null;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  requestedByAdminId?: string | null;
};
