export type RecommendationWorkItem = {
  consumerId: string;
  sourceKey: string;
  accountId: string;
  profileId: string;
  leaseId: string;
  leaseExpiresAt: string;
  throughEventId: number;
  historyGeneration: number;
  pendingEventCount: number;
  profile: {
    name: string;
    isKids: boolean;
    updatedAt: string;
  };
};

export type ClaimRecommendationWorkInput = {
  consumerId: string;
  workerId: string;
  limit: number;
  leaseTtlSeconds: number;
  restrictToUserId?: string | null;
};

export type RenewRecommendationLeaseInput = {
  consumerId: string;
  profileId: string;
  leaseId: string;
  workerId: string;
  leaseTtlSeconds: number;
};

export type CompleteRecommendationLeaseInput = {
  consumerId: string;
  profileId: string;
  leaseId: string;
  workerId: string;
};
