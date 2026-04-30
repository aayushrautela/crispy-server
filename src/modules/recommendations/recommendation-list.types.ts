export type RecommendationWriteSource = 'account_api' | 'reco' | string;
export type RecommendationWriteMode = 'replace' | 'append' | 'clear';

export interface RecommendationListItemInput {
  contentId: string;
  rank: number;
  score?: number | null;
  reasonCodes?: string[];
  metadata?: Record<string, unknown>;
}

export type RecommendationWriteActor =
  | { type: 'account'; accountId: string; userId?: string }
  | { type: 'app'; appId: string; keyId: string };

export interface RecommendationListWriteInput {
  accountId: string;
  profileId: string;
  listKey: string;
  source: RecommendationWriteSource;
  purpose?: string;
  runId?: string;
  batchId?: string;
  writeMode: RecommendationWriteMode;
  items: RecommendationListItemInput[];
  idempotencyKey: string;
  inputVersions?: {
    eligibilityVersion?: number;
    signalsVersion?: number;
    modelVersion?: string;
    algorithm?: string;
  };
  actor: RecommendationWriteActor;
}

export interface RecommendationListWriteResult {
  accountId: string;
  profileId: string;
  listKey: string;
  source: string;
  version: number;
  status: 'written' | 'cleared' | 'idempotent_replay';
  itemCount: number;
  idempotency: { key: string; replayed: boolean };
  createdAt: Date;
}

export interface RecommendationListPolicyDecision {
  allowed: boolean;
  source: string;
  maxItems: number;
  requiresEligibilityAtWrite: boolean;
  rejectReason?: string;
}
