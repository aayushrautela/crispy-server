import { createHash } from 'crypto';
import { HttpError } from '../../lib/errors.js';
import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { AppPrincipal } from './app-principal.types.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { RecommendationListWriteService } from '../recommendations/recommendation-list-write.service.js';
import type { BatchUpsertServiceRecommendationListsRequest, BatchUpsertServiceRecommendationListsResult, ServiceRecommendationListsResponse, UpsertServiceRecommendationListRequest, UpsertServiceRecommendationListResult } from './service-recommendation-list.types.js';
import type { ServiceRecommendationListRepo } from './service-recommendation-list.repo.js';
import { OFFICIAL_RECOMMENDER_APP_ID, OFFICIAL_RECOMMENDER_SOURCE, isOfficialRecommenderListKey } from './official-recommender-lists.js';

export interface ServiceRecommendationListService {
  listWritableLists(input: { principal: AppPrincipal }): Promise<ServiceRecommendationListsResponse>;
  upsertList(input: { principal: AppPrincipal; accountId: string; profileId: string; listKey: string; idempotencyKey: string; request: UpsertServiceRecommendationListRequest }): Promise<UpsertServiceRecommendationListResult>;
  batchUpsert(input: { principal: AppPrincipal; idempotencyKey: string; request: BatchUpsertServiceRecommendationListsRequest }): Promise<BatchUpsertServiceRecommendationListsResult>;
}

export interface Clock { now(): Date }

export class DefaultServiceRecommendationListService implements ServiceRecommendationListService {
  constructor(private readonly deps: { serviceListRepo: ServiceRecommendationListRepo; recommendationListWriteService: RecommendationListWriteService; profileEligibilityService: ProfileEligibilityService; appAuthorizationService: AppAuthorizationService; appAuditRepo: AppAuditRepo; clock: Clock; maxProfilesPerBatch: number; maxListsPerProfile: number }) {}

  async listWritableLists(input: { principal: AppPrincipal }): Promise<ServiceRecommendationListsResponse> {
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'recommendations:service-lists:read' });
    const lists = await this.deps.serviceListRepo.listWritableServiceLists({ appId: input.principal.appId });
    const source = this.deriveSource(input.principal);
    return { appId: input.principal.appId, source, lists };
  }

  async upsertList(input: { principal: AppPrincipal; accountId: string; profileId: string; listKey: string; idempotencyKey: string; request: UpsertServiceRecommendationListRequest }): Promise<UpsertServiceRecommendationListResult> {
    this.rejectCallerSource(input.request);
    if (!input.idempotencyKey) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'recommendations:service-lists:write' });
    const source = this.deriveSource(input.principal);
    await this.requireWritableList(input.principal, input.listKey, source, input.accountId, input.profileId);
    const eligibility = await this.deps.profileEligibilityService.assertEligible({ principal: input.principal, accountId: input.accountId, profileId: input.profileId, purpose: 'recommendation-generation' });
    const result = await this.deps.recommendationListWriteService.writeList({
      accountId: input.accountId,
      profileId: input.profileId,
      listKey: input.listKey,
      source,
      purpose: input.request.purpose,
      runId: input.request.runId,
      writeMode: input.request.writeMode,
      items: input.request.items,
      idempotencyKey: input.idempotencyKey,
      inputVersions: input.request.input,
      actor: { type: 'app', appId: input.principal.appId, keyId: input.principal.keyId },
    });
    return { ...result, eligibility: { checkedAt: eligibility.checkedAt, eligible: eligibility.eligible, eligibilityVersion: eligibility.eligibilityVersion } };
  }

  async batchUpsert(input: { principal: AppPrincipal; idempotencyKey: string; request: BatchUpsertServiceRecommendationListsRequest }): Promise<BatchUpsertServiceRecommendationListsResult> {
    this.rejectCallerSource(input.request);
    if (!input.idempotencyKey) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'recommendations:service-lists:batch-write' });
    this.validateBatchLimits(input.request);
    const existing = await this.deps.serviceListRepo.findBatchIdempotency({ appId: input.principal.appId, idempotencyKey: input.idempotencyKey });
    if (existing) return { ...existing, idempotency: { key: input.idempotencyKey, replayed: true } };
    const results: BatchUpsertServiceRecommendationListsResult['results'] = [];
    let listsWritten = 0;
    let itemsWritten = 0;
    const source = this.deriveSource(input.principal);
    for (const profile of input.request.profiles) {
      try {
        await this.deps.profileEligibilityService.assertEligible({ principal: input.principal, accountId: profile.accountId, profileId: profile.profileId, purpose: 'recommendation-generation' });
        const writtenLists: Array<{ listKey: string; source: string; version: number; itemCount: number }> = [];
        for (const list of profile.lists) {
          await this.requireWritableList(input.principal, list.listKey, source, profile.accountId, profile.profileId);
          const result = await this.deps.recommendationListWriteService.writeList({
            accountId: profile.accountId,
            profileId: profile.profileId,
            listKey: list.listKey,
            source,
            purpose: input.request.purpose,
            runId: input.request.runId,
            batchId: input.request.batchId,
            writeMode: input.request.writeMode,
            items: list.items,
            idempotencyKey: `${input.idempotencyKey}:${profile.accountId}:${profile.profileId}:${list.listKey}`,
            inputVersions: { eligibilityVersion: profile.eligibilityVersion, signalsVersion: profile.signalsVersion },
            actor: { type: 'app', appId: input.principal.appId, keyId: input.principal.keyId },
          });
          writtenLists.push({ listKey: result.listKey, source: result.source, version: result.version, itemCount: result.itemCount });
          listsWritten += 1;
          itemsWritten += result.itemCount;
        }
        results.push({ accountId: profile.accountId, profileId: profile.profileId, status: 'written', lists: writtenLists });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Profile write rejected.';
        const code = error instanceof HttpError ? error.code ?? 'PROFILE_WRITE_REJECTED' : 'PROFILE_WRITE_REJECTED';
        results.push({ accountId: profile.accountId, profileId: profile.profileId, status: 'rejected', error: { code, message } });
      }
    }
    const profilesRejected = results.filter((result) => result.status === 'rejected').length;
    const finalResult: BatchUpsertServiceRecommendationListsResult = {
      runId: input.request.runId,
      batchId: input.request.batchId,
      status: profilesRejected === 0 ? 'completed' : profilesRejected === results.length ? 'failed' : 'completed_with_errors',
      summary: { profilesReceived: input.request.profiles.length, profilesWritten: results.length - profilesRejected, profilesRejected, listsWritten, itemsWritten },
      results,
      idempotency: { key: input.idempotencyKey, replayed: false },
    };
    await this.deps.serviceListRepo.saveBatchIdempotency({ appId: input.principal.appId, idempotencyKey: input.idempotencyKey, requestHash: this.hashRequest(input.request), result: finalResult, createdAt: this.deps.clock.now() });
    await this.deps.appAuditRepo.insert({ appId: input.principal.appId, keyId: input.principal.keyId, action: 'service_recommendation_batch_written', runId: input.request.runId ?? null, batchId: input.request.batchId ?? null, resourceType: 'recommendationBatch', resourceId: input.idempotencyKey, metadata: finalResult.summary });
    return finalResult;
  }

  private deriveSource(principal: AppPrincipal): string {
    const source = principal.ownedSources[0];
    if (!source) throw new HttpError(403, 'App does not own a recommendation source.', undefined, 'APP_SOURCE_MISSING');
    if (source === 'account_api') throw new HttpError(403, 'App cannot write account_api source.', undefined, 'PROTECTED_SOURCE');
    return source;
  }

  private async requireWritableList(principal: AppPrincipal, listKey: string, source: string, accountId: string, profileId: string): Promise<void> {
    if (principal.appId === OFFICIAL_RECOMMENDER_APP_ID) {
      if (source !== OFFICIAL_RECOMMENDER_SOURCE) throw new HttpError(403, 'official-recommender must use official-recommender source.', undefined, 'INVALID_SOURCE');
      if (!isOfficialRecommenderListKey(listKey)) throw new HttpError(403, 'List key not in official-recommender contract.', undefined, 'LIST_KEY_NOT_ALLOWED');
    }
    this.deps.appAuthorizationService.requireOwnedListKey({ principal, source, listKey });
    this.deps.appAuthorizationService.requireGrant({ principal, resourceType: 'recommendationList', resourceId: listKey, purpose: 'recommendation-generation', action: 'write', accountId, profileId, listKey, source });
    const descriptor = await this.deps.serviceListRepo.findWritableServiceList({ appId: principal.appId, listKey });
    if (!descriptor || descriptor.source !== source) throw new HttpError(403, 'App does not own recommendation list.', undefined, 'LIST_NOT_OWNED');
  }

  private validateBatchLimits(request: BatchUpsertServiceRecommendationListsRequest): void {
    if (!Array.isArray(request.profiles) || request.profiles.length === 0) throw new HttpError(400, 'profiles must be a non-empty array.', undefined, 'INVALID_PROFILES');
    if (request.profiles.length > this.deps.maxProfilesPerBatch) throw new HttpError(400, 'profiles exceeds batch limit.', undefined, 'BATCH_LIMIT_EXCEEDED');
    for (const profile of request.profiles) {
      if (!Array.isArray(profile.lists) || profile.lists.length === 0) throw new HttpError(400, 'Each profile requires lists.', undefined, 'INVALID_PROFILE_LISTS');
      if (profile.lists.length > this.deps.maxListsPerProfile) throw new HttpError(400, 'lists exceeds per-profile limit.', undefined, 'PROFILE_LIST_LIMIT_EXCEEDED');
    }
  }

  private rejectCallerSource(value: unknown): void {
    if (value && typeof value === 'object' && 'source' in value) throw new HttpError(400, 'source is server-derived and must not be supplied.', undefined, 'CALLER_SOURCE_REJECTED');
  }

  private hashRequest(request: BatchUpsertServiceRecommendationListsRequest): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
  }
}
