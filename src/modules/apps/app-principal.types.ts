export type AppId = string;
export type AppKeyId = string;
export type AppPrincipalType = 'service_app';
export type AppStatus = 'active' | 'disabled' | 'deleted';
export type AppKeyStatus = 'active' | 'disabled' | 'expired' | 'revoked';

export type AppGrantResourceType =
  | 'profileSignals'
  | 'aiConfig'
  | 'recommendationList'
  | 'profileEligibility'
  | 'recommendationRun'
  | 'recommendationBatch'
  | 'auditEvents';

export type AppGrantAction = 'read' | 'write' | 'create' | 'update' | 'claim';
export type AppPurpose = 'recommendation-generation';

export type AppScope =
  | 'apps:self:read'
  | 'profiles:eligible:read'
  | 'profiles:eligible:snapshot:create'
  | 'profiles:eligible:snapshot:read'
  | 'profiles:signals:read'
  | 'recommendations:service-lists:read'
  | 'recommendations:service-lists:write'
  | 'recommendations:service-lists:batch-write'
  | 'recommendations:runs:write'
  | 'recommendations:batches:write'
  | 'recommendations:backfills:read'
  | 'apps:audit:read'
  | 'confidential-config:ai-config:read';

export type AppRateLimitRouteGroup =
  | 'apps.self'
  | 'profiles.eligible.changes'
  | 'profiles.eligible.snapshots'
  | 'profiles.signals'
  | 'recommendations.service-lists'
  | 'recommendations.single-write'
  | 'recommendations.batch-write'
  | 'recommendations.runs'
  | 'recommendations.batches'
  | 'recommendations.backfills'
  | 'confidential.config-bundle'
  | 'apps.audit';

export interface AppRegistryEntry {
  appId: AppId;
  name: string;
  description?: string;
  status: AppStatus;
  ownerTeam: string;
  allowedEnvironments: string[];
  principalType: AppPrincipalType;
  createdAt: Date;
  updatedAt: Date;
  disabledAt?: Date | null;
}

export interface AppKeyRecord {
  keyId: AppKeyId;
  appId: AppId;
  keyHash: string;
  status: AppKeyStatus;
  createdAt: Date;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  rotationGroup?: string | null;
  allowedIpCidrs?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

export type ConfidentialSecretDeliveryMode = 'proxy' | 'reference';

export interface AppGrantConstraintSet {
  source?: string;
  listKey?: string;
  eligibleProfilesOnly?: boolean;
  maxItems?: number;
  maxHistoryItems?: number;
  maxRatingsItems?: number;
  maxWatchlistItems?: number;
  maxContinueItems?: number;
  secretDeliveryModes?: ConfidentialSecretDeliveryMode[];
  allowServerFallback?: boolean;
  accountIds?: string[];
  profileIds?: string[];
  routeGroups?: string[];
}

export interface AppGrant {
  grantId: string;
  appId: AppId;
  resourceType: AppGrantResourceType;
  resourceId: string;
  purpose: AppPurpose;
  actions: AppGrantAction[];
  constraints: AppGrantConstraintSet;
  status: 'active' | 'disabled' | 'expired';
  createdAt: Date;
  expiresAt?: Date | null;
}

export interface AppRateLimitPolicy {
  profileChangesReadsPerMinute: number;
  profileSignalReadsPerMinute: number;
  recommendationWritesPerMinute: number;
  batchWritesPerMinute: number;
  configBundleReadsPerMinute: number;
  runsPerHour: number;
  snapshotsPerDay: number;
  maxProfilesPerBatch: number;
  maxItemsPerList: number;
}

export interface AppPrincipal {
  principalType: 'app';
  appId: AppId;
  keyId: AppKeyId;
  scopes: AppScope[];
  grants: AppGrant[];
  ownedSources: string[];
  ownedListKeys: string[];
  rateLimitPolicy: AppRateLimitPolicy;
  registryEntry: AppRegistryEntry;
}
