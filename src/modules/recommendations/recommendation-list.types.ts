export type RecommendationHomeSectionType = 'categoryTabs' | 'heroCarousel' | 'contentRail' | 'collectionRail';
export type RecommendationWriteSource = 'account_api' | 'reco' | string;
export type RecommendationWriteMode = 'replace' | 'append' | 'clear';

export interface RecommendationListItemInput {
  itemId: string;
  rank: number;
  sourceRef?: { provider: string; providerId: string } | null;
  score?: number | null;
  description?: string;
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
  sectionType: RecommendationHomeSectionType;
  title: string;
  subtitle: string | null;
  items: RecommendationListItemInput[];
  idempotencyKey: string;
  inputVersions?: {
    eligibilityVersion?: number;
    signalsVersion?: number;
    modelVersion?: string | null;
    algorithm?: string | null;
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
