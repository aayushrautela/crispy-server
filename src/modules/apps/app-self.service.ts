import type { AppPrincipal } from './app-principal.types.js';

export interface AppSelfService {
  getAppSelf(principal: AppPrincipal): Promise<AppSelfResponse>;
}

export interface AppSelfResponse {
  appId: string;
  name: string;
  description?: string;
  status: string;
  principalType: string;
  scopes: string[];
  ownedSources: string[];
  ownedListKeys: string[];
  rateLimitPolicy: {
    profileChangesReadsPerMinute: number;
    profileSignalReadsPerMinute: number;
    recommendationWritesPerMinute: number;
    batchWritesPerMinute: number;
    configBundleReadsPerMinute: number;
    runsPerHour: number;
    snapshotsPerDay: number;
    maxProfilesPerBatch: number;
    maxItemsPerList: number;
  };
}

export class DefaultAppSelfService implements AppSelfService {
  async getAppSelf(principal: AppPrincipal): Promise<AppSelfResponse> {
    return {
      appId: principal.appId,
      name: principal.registryEntry.name,
      description: principal.registryEntry.description,
      status: principal.registryEntry.status,
      principalType: principal.registryEntry.principalType,
      scopes: principal.scopes,
      ownedSources: principal.ownedSources,
      ownedListKeys: principal.ownedListKeys,
      rateLimitPolicy: principal.rateLimitPolicy,
    };
  }
}
