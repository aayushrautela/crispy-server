import { createHash } from 'crypto';
import { HttpError } from '../../lib/errors.js';
import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { AppPrincipal } from './app-principal.types.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { RecommendationListWriteService } from '../recommendations/recommendation-list-write.service.js';
import type { RecommendationListItemInput } from '../recommendations/recommendation-list.types.js';
import type { BatchUpsertServiceRecommendationListsRequest, BatchUpsertServiceRecommendationListsResult, ServiceRecommendationItemRef, ServiceRecommendationListsResponse, UpsertServiceRecommendationListRequest, UpsertServiceRecommendationListResult } from './service-recommendation-list.types.js';
import type { ServiceRecommendationListRepo } from './service-recommendation-list.repo.js';
import { OFFICIAL_RECOMMENDER_APP_ID, OFFICIAL_RECOMMENDER_SOURCE, isOfficialRecommenderListKey } from './official-recommender-lists.js';

const RECOMMENDATION_WRITE_PURPOSE = 'recommendation-generation' as const;
const RECOMMENDATION_WRITE_MODE = 'replace' as const;
const ITEM_TYPES = new Set(['movie', 'tv']);
const TOP_LEVEL_REMOVED_FIELDS = ['source', 'purpose', 'writeMode', 'input', 'eligibilityVersion', 'signalsVersion', 'modelVersion', 'algorithm', 'runId', 'batchId'];
const ITEM_REMOVED_FIELDS = ['contentId', 'mediaKey', 'rank', 'score', 'reason', 'reasonCodes', 'metadata', 'media', 'payload', 'provider', 'providerItemId', 'title', 'artists', 'album', 'imageUrl', 'durationMs', 'releaseDate', 'explicit'];

export interface ServiceRecommendationListService {
  listWritableLists(input: { principal: AppPrincipal }): Promise<ServiceRecommendationListsResponse>;
  upsertList(input: { principal: AppPrincipal; accountId: string; profileId: string; listKey: string; idempotencyKey: string; request: UpsertServiceRecommendationListRequest }): Promise<UpsertServiceRecommendationListResult>;
  batchUpsert(input: { principal: AppPrincipal; idempotencyKey: string; request: BatchUpsertServiceRecommendationListsRequest }): Promise<BatchUpsertServiceRecommendationListsResult>;
}

export interface Clock { now(): Date }

interface NormalizedSingleRequest {
  items: RecommendationListItemInput[];
}

interface NormalizedBatchRequest {
  profiles: Array<{
    accountId: string;
    profileId: string;
    lists: Array<{ listKey: string; items: RecommendationListItemInput[] }>;
  }>;
}

export class DefaultServiceRecommendationListService implements ServiceRecommendationListService {
  constructor(private readonly deps: { serviceListRepo: ServiceRecommendationListRepo; recommendationListWriteService: RecommendationListWriteService; profileEligibilityService: ProfileEligibilityService; appAuthorizationService: AppAuthorizationService; appAuditRepo: AppAuditRepo; clock: Clock; maxProfilesPerBatch: number; maxListsPerProfile: number }) {}

  async listWritableLists(input: { principal: AppPrincipal }): Promise<ServiceRecommendationListsResponse> {
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'recommendations:service-lists:read' });
    const lists = await this.deps.serviceListRepo.listWritableServiceLists({ appId: input.principal.appId });
    const source = this.deriveSource(input.principal);
    return { appId: input.principal.appId, source, lists };
  }

  async upsertList(input: { principal: AppPrincipal; accountId: string; profileId: string; listKey: string; idempotencyKey: string; request: UpsertServiceRecommendationListRequest }): Promise<UpsertServiceRecommendationListResult> {
    const request = this.validateSingleRequest(input.request);
    if (!input.idempotencyKey) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'recommendations:service-lists:write' });
    const source = this.deriveSource(input.principal);
    await this.requireWritableList(input.principal, input.listKey, source, input.accountId, input.profileId);
    const eligibility = await this.deps.profileEligibilityService.assertEligible({ principal: input.principal, accountId: input.accountId, profileId: input.profileId, purpose: RECOMMENDATION_WRITE_PURPOSE });
    const result = await this.deps.recommendationListWriteService.writeList({
      accountId: input.accountId,
      profileId: input.profileId,
      listKey: input.listKey,
      source,
      purpose: RECOMMENDATION_WRITE_PURPOSE,
      writeMode: RECOMMENDATION_WRITE_MODE,
      items: request.items,
      idempotencyKey: input.idempotencyKey,
      inputVersions: { eligibilityVersion: eligibility.eligibilityVersion },
      actor: { type: 'app', appId: input.principal.appId, keyId: input.principal.keyId },
    });
    return { ...result, eligibility: { checkedAt: eligibility.checkedAt, eligible: eligibility.eligible, eligibilityVersion: eligibility.eligibilityVersion } };
  }

  async batchUpsert(input: { principal: AppPrincipal; idempotencyKey: string; request: BatchUpsertServiceRecommendationListsRequest }): Promise<BatchUpsertServiceRecommendationListsResult> {
    const request = this.validateBatchRequest(input.request);
    if (!input.idempotencyKey) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'recommendations:service-lists:batch-write' });
    this.validateBatchLimits(request);
    const existing = await this.deps.serviceListRepo.findBatchIdempotency({ appId: input.principal.appId, idempotencyKey: input.idempotencyKey });
    if (existing) {
      if (existing.requestHash !== this.hashRequest(request)) throw new HttpError(409, 'Idempotency-Key was reused with a different request.', undefined, 'IDEMPOTENCY_CONFLICT');
      return { ...existing, idempotency: { key: input.idempotencyKey, replayed: true } };
    }
    const results: BatchUpsertServiceRecommendationListsResult['results'] = [];
    let listsWritten = 0;
    let itemsWritten = 0;
    const source = this.deriveSource(input.principal);
    for (const profile of request.profiles) {
      try {
        const eligibility = await this.deps.profileEligibilityService.assertEligible({ principal: input.principal, accountId: profile.accountId, profileId: profile.profileId, purpose: RECOMMENDATION_WRITE_PURPOSE });
        const writtenLists: Array<{ listKey: string; source: string; version: number; itemCount: number }> = [];
        for (const list of profile.lists) {
          await this.requireWritableList(input.principal, list.listKey, source, profile.accountId, profile.profileId);
          const result = await this.deps.recommendationListWriteService.writeList({
            accountId: profile.accountId,
            profileId: profile.profileId,
            listKey: list.listKey,
            source,
            purpose: RECOMMENDATION_WRITE_PURPOSE,
            writeMode: RECOMMENDATION_WRITE_MODE,
            items: list.items,
            idempotencyKey: `${input.idempotencyKey}:${profile.accountId}:${profile.profileId}:${list.listKey}`,
            inputVersions: { eligibilityVersion: eligibility.eligibilityVersion },
            actor: { type: 'app', appId: input.principal.appId, keyId: input.principal.keyId },
          });
          writtenLists.push({ listKey: result.listKey, source: result.source, version: result.version, itemCount: result.itemCount });
          listsWritten += 1;
          itemsWritten += result.itemCount;
        }
        results.push({ accountId: profile.accountId, profileId: profile.profileId, status: 'written', lists: writtenLists });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Profile write rejected.';
        const code = error instanceof HttpError ? error.code : 'PROFILE_WRITE_REJECTED';
        const details = error instanceof HttpError ? error.details : undefined;
        results.push({ accountId: profile.accountId, profileId: profile.profileId, status: 'rejected', error: { code, message, details } });
      }
    }
    const profilesRejected = results.filter((result) => result.status === 'rejected').length;
    const finalResult: BatchUpsertServiceRecommendationListsResult = {
      status: profilesRejected === 0 ? 'completed' : profilesRejected === results.length ? 'failed' : 'completed_with_errors',
      summary: { profilesReceived: request.profiles.length, profilesWritten: results.length - profilesRejected, profilesRejected, listsWritten, itemsWritten },
      results,
      idempotency: { key: input.idempotencyKey, replayed: false },
      requestHash: this.hashRequest(request),
    };
    await this.deps.serviceListRepo.saveBatchIdempotency({ appId: input.principal.appId, idempotencyKey: input.idempotencyKey, requestHash: this.hashRequest(request), result: finalResult, createdAt: this.deps.clock.now() });
    await this.deps.appAuditRepo.insert({ appId: input.principal.appId, keyId: input.principal.keyId, action: 'service_recommendation_batch_written', runId: null, batchId: null, resourceType: 'recommendationBatch', resourceId: input.idempotencyKey, metadata: finalResult.summary });
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
    this.deps.appAuthorizationService.requireGrant({ principal, resourceType: 'recommendationList', resourceId: listKey, purpose: RECOMMENDATION_WRITE_PURPOSE, action: 'write', accountId, profileId, listKey, source });
    const descriptor = await this.deps.serviceListRepo.findWritableServiceList({ appId: principal.appId, listKey });
    if (!descriptor || descriptor.source !== source) throw new HttpError(403, 'App does not own recommendation list.', undefined, 'LIST_NOT_OWNED');
  }

  private validateBatchLimits(request: NormalizedBatchRequest): void {
    if (request.profiles.length > this.deps.maxProfilesPerBatch) throw new HttpError(400, 'profiles exceeds batch limit.', { field: 'profiles' }, 'BATCH_LIMIT_EXCEEDED');
    request.profiles.forEach((profile, index) => {
      if (profile.lists.length > this.deps.maxListsPerProfile) throw new HttpError(400, 'lists exceeds per-profile limit.', { field: `profiles[${index}].lists` }, 'PROFILE_LIST_LIMIT_EXCEEDED');
    });
  }

  private validateSingleRequest(request: unknown): NormalizedSingleRequest {
    assertRecord(request, 'request body');
    rejectRemovedFields(request, TOP_LEVEL_REMOVED_FIELDS, '');
    assertOnlyKeys(request, ['items'], '');
    return { items: normalizeItemRefs(request.items, 'items') };
  }

  private validateBatchRequest(request: unknown): NormalizedBatchRequest {
    assertRecord(request, 'request body');
    rejectRemovedFields(request, TOP_LEVEL_REMOVED_FIELDS, '');
    assertOnlyKeys(request, ['profiles'], '');
    if (!Array.isArray(request.profiles) || request.profiles.length === 0) throw new HttpError(400, 'profiles must be a non-empty array.', { field: 'profiles' }, 'INVALID_PROFILES');
    return {
      profiles: request.profiles.map((rawProfile, profileIndex) => {
        const profilePath = `profiles[${profileIndex}]`;
        assertRecord(rawProfile, profilePath);
        rejectRemovedFields(rawProfile, ['eligibilityVersion', 'signalsVersion', ...TOP_LEVEL_REMOVED_FIELDS], profilePath);
        assertOnlyKeys(rawProfile, ['accountId', 'profileId', 'lists'], profilePath);
        if (typeof rawProfile.accountId !== 'string' || !rawProfile.accountId.trim()) throw new HttpError(400, `${profilePath}.accountId is required.`, { field: `${profilePath}.accountId` }, 'INVALID_ACCOUNT_ID');
        if (typeof rawProfile.profileId !== 'string' || !rawProfile.profileId.trim()) throw new HttpError(400, `${profilePath}.profileId is required.`, { field: `${profilePath}.profileId` }, 'INVALID_PROFILE_ID');
        if (!Array.isArray(rawProfile.lists) || rawProfile.lists.length === 0) throw new HttpError(400, `${profilePath}.lists must be a non-empty array.`, { field: `${profilePath}.lists` }, 'INVALID_PROFILE_LISTS');
        return {
          accountId: rawProfile.accountId,
          profileId: rawProfile.profileId,
          lists: rawProfile.lists.map((rawList, listIndex) => {
            const listPath = `${profilePath}.lists[${listIndex}]`;
            assertRecord(rawList, listPath);
            rejectRemovedFields(rawList, TOP_LEVEL_REMOVED_FIELDS, listPath);
            assertOnlyKeys(rawList, ['listKey', 'items'], listPath);
            if (typeof rawList.listKey !== 'string' || !rawList.listKey.trim()) throw new HttpError(400, `${listPath}.listKey is required.`, { field: `${listPath}.listKey` }, 'INVALID_LIST_KEY');
            return { listKey: rawList.listKey, items: normalizeItemRefs(rawList.items, `${listPath}.items`) };
          }),
        };
      }),
    };
  }

  private hashRequest(request: NormalizedBatchRequest): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
  }
}

function normalizeItemRefs(value: unknown, path: string): RecommendationListItemInput[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${path} must be an array.`, { field: path }, 'INVALID_RECOMMENDATION_ITEMS');
  const seen = new Set<string>();
  return value.map((rawItem, index) => {
    const itemPath = `${path}[${index}]`;
    const item = validateItemRef(rawItem, itemPath);
    const contentId = buildCanonicalContentId(item.type, item.tmdbId);
    if (seen.has(contentId)) throw new HttpError(400, `Duplicate recommendation item at ${itemPath}.`, { field: itemPath, mediaKey: contentId }, 'DUPLICATE_RECOMMENDATION_ITEM');
    seen.add(contentId);
    return { contentId, rank: index + 1 };
  });
}

function validateItemRef(value: unknown, path: string): ServiceRecommendationItemRef {
  assertRecord(value, path);
  rejectRemovedFields(value, ITEM_REMOVED_FIELDS, path);
  assertOnlyKeys(value, ['type', 'tmdbId'], path);
  if (!ITEM_TYPES.has(String(value.type))) throw new HttpError(400, `${path}.type must be movie or tv.`, { field: `${path}.type` }, 'INVALID_RECOMMENDATION_ITEM_TYPE');
  if (typeof value.tmdbId !== 'number' || !Number.isSafeInteger(value.tmdbId) || value.tmdbId < 1) throw new HttpError(400, `${path}.tmdbId must be a positive integer.`, { field: `${path}.tmdbId` }, 'INVALID_RECOMMENDATION_TMDB_ID');
  return { type: value.type as ServiceRecommendationItemRef['type'], tmdbId: value.tmdbId };
}

function buildCanonicalContentId(type: ServiceRecommendationItemRef['type'], tmdbId: number): string {
  return `${type}:tmdb:${tmdbId}`;
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, `${path} must be an object.`, { field: path }, 'INVALID_REQUEST_BODY');
}

function rejectRemovedFields(value: Record<string, unknown>, fields: string[], path: string): void {
  for (const field of fields) {
    if (field in value) {
      const qualifiedField = path ? `${path}.${field}` : field;
      throw new HttpError(400, `${qualifiedField} is server-derived and must not be supplied.`, { field: qualifiedField }, 'UNSUPPORTED_RECOMMENDATION_WRITE_FIELD');
    }
  }
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      const qualifiedField = path ? `${path}.${key}` : key;
      throw new HttpError(400, `${qualifiedField} is not supported.`, { field: qualifiedField }, 'UNSUPPORTED_RECOMMENDATION_WRITE_FIELD');
    }
  }
}
