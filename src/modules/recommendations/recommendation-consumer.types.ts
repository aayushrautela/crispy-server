export type RecommendationConsumerOwnerKind = 'service' | 'user' | 'oauth_app';

export type RecommendationConsumerRecord = {
  id: string;
  consumerKey: string;
  ownerKind: RecommendationConsumerOwnerKind;
  ownerUserId: string | null;
  displayName: string;
  sourceKey: string;
  isInternal: boolean;
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt: string;
};

export type RecommendationProfileWorkStateRecord = {
  consumerId: string;
  profileId: string;
  lastCompletedEventId: number;
  claimedThroughEventId: number | null;
  claimedHistoryGeneration: number | null;
  leaseId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
};
