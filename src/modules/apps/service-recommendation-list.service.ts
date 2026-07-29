import { createHash } from 'crypto';
import { HttpError } from '../../lib/errors.js';
import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { AppPrincipal } from './app-principal.types.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { HomeWriteService } from '../home/home-write.service.js';
import type { RecommendationListItemInput } from '../recommendations/recommendation-list.types.js';
import type { RecoHomeSectionType, RecoProvider, RecoWriteItem } from '../recommendations/reco-contract.types.js';
import type { BatchUpsertServiceRecommendationListsRequest, BatchUpsertServiceRecommendationListsResult, UpsertServiceRecommendationListRequest, UpsertServiceRecommendationListResult } from './service-recommendation-list.types.js';
import type { ServiceRecommendationListRepo } from './service-recommendation-list.repo.js';

const RECOMMENDATION_WRITE_PURPOSE = 'recommendation-generation' as const;
const PROVIDERS = new Set(['tmdb', 'tvdb', 'imdb', 'kitsu']);

/** Strip tolerated-but-ignored producer fields at the boundary. The ingester
 *  only takes type + providerRefs + optional metadata hints; score, reason,
 *  reasonCodes, rank are accepted by the wire contract but not persisted. */
function toHomeWriteItem(item: RecoWriteItem): { type: RecoWriteItem['type']; providerRefs: RecoWriteItem['providerRefs']; metadata?: Record<string, unknown> } {
  return { type: item.type, providerRefs: item.providerRefs, ...(item.metadata && Object.keys(item.metadata).length > 0 ? { metadata: item.metadata } : {}) };
}
const ITEM_TYPES = new Set(['movie', 'tv']);
const HOME_SECTION_TYPES = new Set(['categoryTabs', 'heroCarousel', 'contentRail', 'collectionRail']);
const TOP_LEVEL_REMOVED_FIELDS = ['source', 'purpose', 'writeMode', 'input', 'eligibilityVersion', 'signalsVersion', 'algorithm', 'batchId'];
const ITEM_REMOVED_FIELDS = ['contentId', 'itemId', 'mediaKey', 'rank', 'tmdbId', 'tvdbId', 'providerId', 'media', 'payload', 'title', 'artists', 'album', 'imageUrl', 'durationMs', 'releaseDate', 'explicit'];

export interface ServiceRecommendationListService {
  upsertList(input: { principal: AppPrincipal; accountId: string; profileId: string; listKey: string; idempotencyKey: string; request: UpsertServiceRecommendationListRequest }): Promise<UpsertServiceRecommendationListResult>;
  batchUpsert(input: { principal: AppPrincipal; idempotencyKey: string; request: BatchUpsertServiceRecommendationListsRequest }): Promise<BatchUpsertServiceRecommendationListsResult>;
}

export interface Clock { now(): Date }

interface NormalizedSingleRequest {
  title: string;
  subtitle: string | null;
  sectionType: RecoHomeSectionType;
  items: RecoWriteItem[];
  model: UpsertServiceRecommendationListRequest['model'];
  context: Record<string, unknown>;
}

interface NormalizedBatchRequest {
  profiles: Array<{
    accountId: string;
    profileId: string;
    lists: Array<{ listKey: string } & NormalizedSingleRequest>;
  }>;
}

export class DefaultServiceRecommendationListService implements ServiceRecommendationListService {
  constructor(private readonly deps: { serviceListRepo: ServiceRecommendationListRepo; homeWriteService: HomeWriteService; profileEligibilityService: ProfileEligibilityService; appAuthorizationService: AppAuthorizationService; appAuditRepo: AppAuditRepo; clock: Clock; maxProfilesPerBatch: number; maxListsPerProfile: number }) {}

  async upsertList(input: { principal: AppPrincipal; accountId: string; profileId: string; listKey: string; idempotencyKey: string; request: UpsertServiceRecommendationListRequest }): Promise<UpsertServiceRecommendationListResult> {
    const request = await this.validateSingleRequest(input.request);
    if (!input.idempotencyKey) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'recommendations:service-lists:write' });
    const source = this.deriveSource(input.principal);
    await this.requireWritableList(input.principal, input.listKey, source, request.sectionType, input.accountId, input.profileId);
    const eligibility = await this.deps.profileEligibilityService.assertEligible({ principal: input.principal, accountId: input.accountId, profileId: input.profileId, purpose: RECOMMENDATION_WRITE_PURPOSE });
    await this.deps.homeWriteService.writeHome({
      accountId: input.accountId,
      profileId: input.profileId,
      source,
      idempotencyKey: input.idempotencyKey,
      actor: { type: 'app', appId: input.principal.appId, keyId: input.principal.keyId },
      lists: [{
        listKey: input.listKey,
        sectionType: request.sectionType,
        title: request.title,
        subtitle: request.subtitle,
        items: request.items.map(toHomeWriteItem),
      }],
    });
    return { accountId: input.accountId, profileId: input.profileId, listKey: input.listKey, source, version: 0, status: 'written', itemCount: request.items.length, idempotency: { key: input.idempotencyKey, replayed: false }, createdAt: this.deps.clock.now(), eligibility: { checkedAt: eligibility.checkedAt, eligible: eligibility.eligible, eligibilityVersion: eligibility.eligibilityVersion } };
  }

  async batchUpsert(input: { principal: AppPrincipal; idempotencyKey: string; request: BatchUpsertServiceRecommendationListsRequest }): Promise<BatchUpsertServiceRecommendationListsResult> {
    const request = await this.validateBatchRequest(input.request);
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
        for (const list of profile.lists) {
          await this.requireWritableList(input.principal, list.listKey, source, list.sectionType, profile.accountId, profile.profileId);
        }
        await this.deps.homeWriteService.writeHome({
          accountId: profile.accountId,
          profileId: profile.profileId,
          source,
          idempotencyKey: `${input.idempotencyKey}:${profile.accountId}:${profile.profileId}`,
          actor: { type: 'app', appId: input.principal.appId, keyId: input.principal.keyId },
          lists: profile.lists.map((list) => ({
            listKey: list.listKey,
            sectionType: list.sectionType,
            title: list.title,
            subtitle: list.subtitle,
            items: list.items.map(toHomeWriteItem),
          })),
        });
        const writtenLists = profile.lists.map((list) => ({ listKey: list.listKey, source, version: 0, itemCount: list.items.length }));
        listsWritten += profile.lists.length;
        itemsWritten += profile.lists.reduce((sum, list) => sum + list.items.length, 0);
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

  private async requireWritableList(principal: AppPrincipal, listKey: string, source: string, sectionType: RecoHomeSectionType, accountId: string, profileId: string): Promise<void> {
    void sectionType;
    this.deps.appAuthorizationService.requireOwnedSource({ principal, source });
    this.deps.appAuthorizationService.requireGrant({ principal, resourceType: 'recommendationList', resourceId: listKey, purpose: RECOMMENDATION_WRITE_PURPOSE, action: 'write', accountId, profileId, listKey, source });
  }

  private validateBatchLimits(request: NormalizedBatchRequest): void {
    if (request.profiles.length > this.deps.maxProfilesPerBatch) throw new HttpError(400, 'profiles exceeds batch limit.', { field: 'profiles' }, 'BATCH_LIMIT_EXCEEDED');
    request.profiles.forEach((profile, index) => {
      if (profile.lists.length > this.deps.maxListsPerProfile) throw new HttpError(400, 'lists exceeds per-profile limit.', { field: `profiles[${index}].lists` }, 'PROFILE_LIST_LIMIT_EXCEEDED');
    });
  }

  private async validateSingleRequest(request: unknown): Promise<NormalizedSingleRequest> {
    assertRecord(request, 'request body');
    rejectRemovedFields(request, TOP_LEVEL_REMOVED_FIELDS, '');
    assertOnlyKeys(request, ['title', 'subtitle', 'sectionType', 'items', 'model', 'context'], '');
    return {
      title: readRequiredString(request.title, 'title'),
      subtitle: readNullableString(request.subtitle, 'subtitle'),
      sectionType: readHomeSectionType(request.sectionType, 'sectionType'),
      items: await this.normalizeItemRefs(request.items, 'items'),
      model: readModelInfo(request.model, 'model'),
      context: asRecordOrEmpty(request.context),
    };
  }

  private async validateBatchRequest(request: unknown): Promise<NormalizedBatchRequest> {
    assertRecord(request, 'request body');
    rejectRemovedFields(request, TOP_LEVEL_REMOVED_FIELDS, '');
    assertOnlyKeys(request, ['profiles'], '');
    if (!Array.isArray(request.profiles) || request.profiles.length === 0) throw new HttpError(400, 'profiles must be a non-empty array.', { field: 'profiles' }, 'INVALID_PROFILES');
    const profiles = [];
    for (const [profileIndex, rawProfile] of request.profiles.entries()) {
      const profilePath = `profiles[${profileIndex}]`;
      assertRecord(rawProfile, profilePath);
      rejectRemovedFields(rawProfile, ['eligibilityVersion', 'signalsVersion', ...TOP_LEVEL_REMOVED_FIELDS], profilePath);
      assertOnlyKeys(rawProfile, ['accountId', 'profileId', 'lists'], profilePath);
      if (typeof rawProfile.accountId !== 'string' || !rawProfile.accountId.trim()) throw new HttpError(400, `${profilePath}.accountId is required.`, { field: `${profilePath}.accountId` }, 'INVALID_ACCOUNT_ID');
      if (typeof rawProfile.profileId !== 'string' || !rawProfile.profileId.trim()) throw new HttpError(400, `${profilePath}.profileId is required.`, { field: `${profilePath}.profileId` }, 'INVALID_PROFILE_ID');
      if (!Array.isArray(rawProfile.lists) || rawProfile.lists.length === 0) throw new HttpError(400, `${profilePath}.lists must be a non-empty array.`, { field: `${profilePath}.lists` }, 'INVALID_PROFILE_LISTS');
      const lists = [];
      for (const [listIndex, rawList] of rawProfile.lists.entries()) {
        const listPath = `${profilePath}.lists[${listIndex}]`;
        assertRecord(rawList, listPath);
        rejectRemovedFields(rawList, TOP_LEVEL_REMOVED_FIELDS, listPath);
        assertOnlyKeys(rawList, ['listKey', 'title', 'subtitle', 'sectionType', 'items', 'model', 'context'], listPath);
        if (typeof rawList.listKey !== 'string' || !rawList.listKey.trim()) throw new HttpError(400, `${listPath}.listKey is required.`, { field: `${listPath}.listKey` }, 'INVALID_LIST_KEY');
        lists.push({
          listKey: rawList.listKey,
          title: readRequiredString(rawList.title, `${listPath}.title`),
          subtitle: readNullableString(rawList.subtitle, `${listPath}.subtitle`),
          sectionType: readHomeSectionType(rawList.sectionType, `${listPath}.sectionType`),
          items: await this.normalizeItemRefs(rawList.items, `${listPath}.items`),
          model: readModelInfo(rawList.model, `${listPath}.model`),
          context: asRecordOrEmpty(rawList.context),
        });
      }
      profiles.push({ accountId: rawProfile.accountId, profileId: rawProfile.profileId, lists });
    }
    return { profiles };
  }

  private hashRequest(request: NormalizedBatchRequest): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
  }

  private async normalizeItemRefs(value: unknown, path: string): Promise<RecoWriteItem[]> {
    if (!Array.isArray(value)) throw new HttpError(400, `${path} must be an array.`, { field: path }, 'INVALID_RECOMMENDATION_ITEMS');
    const seen = new Set<string>();
    const items: RecoWriteItem[] = [];
    for (const [index, rawItem] of value.entries()) {
      const itemPath = `${path}[${index}]`;
      const item = validateWriteItem(rawItem, itemPath);
      const ref = item.providerRefs[0];
      if (!ref) throw new HttpError(400, `${itemPath}.providerRefs must contain at least one provider ref.`, { field: `${itemPath}.providerRefs` }, 'INVALID_RECOMMENDATION_PROVIDER_REF');
      const dupKey = `${item.type}:${ref.provider}:${ref.providerId}`;
      if (seen.has(dupKey)) throw new HttpError(400, `Duplicate recommendation item at ${itemPath}.`, { field: itemPath, ref }, 'DUPLICATE_RECOMMENDATION_ITEM');
      seen.add(dupKey);
      items.push(item);
    }
    return items;
  }
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

function readRequiredString(value: unknown, path: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new HttpError(400, `${path} is required.`, { field: path }, 'INVALID_RECOMMENDATION_LIST_TITLE');
}

function readNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value.trim() || null;
  throw new HttpError(400, `${path} must be a string or null.`, { field: path }, 'INVALID_RECOMMENDATION_LIST_SUBTITLE');
}

function readHomeSectionType(value: unknown, path: string): RecoHomeSectionType {
  if (typeof value === 'string' && HOME_SECTION_TYPES.has(value)) return value as RecoHomeSectionType;
  throw new HttpError(400, `${path} must be one of categoryTabs, heroCarousel, contentRail, or collectionRail.`, { field: path }, 'INVALID_RECOMMENDATION_SECTION_TYPE');
}

function readModelInfo(value: unknown, path: string): UpsertServiceRecommendationListRequest['model'] {
  if (value === null) return null;
  assertRecord(value, path);
  assertOnlyKeys(value, ['runId', 'algorithmVersion', 'modelVersion'], path);
  return {
    runId: readOptionalString(value.runId, `${path}.runId`),
    algorithmVersion: readRequiredString(value.algorithmVersion, `${path}.algorithmVersion`),
    modelVersion: readOptionalString(value.modelVersion, `${path}.modelVersion`),
  };
}

function readOptionalString(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value.trim() || null;
  throw new HttpError(400, `${path} must be a string or null.`, { field: path }, 'INVALID_RECOMMENDATION_WRITE_FIELD');
}

function asRecordOrEmpty(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  assertRecord(value, 'context');
  return value;
}

function validateWriteItem(value: unknown, path: string): RecoWriteItem {
  assertRecord(value, path);
  rejectRemovedFields(value, ITEM_REMOVED_FIELDS, path);
  assertOnlyKeys(value, ['type', 'providerRefs', 'score', 'reason', 'reasonCodes', 'metadata'], path);
  const reasonCodes = value.reasonCodes === undefined ? [] : value.reasonCodes;
  if (!Array.isArray(reasonCodes) || reasonCodes.some((code) => typeof code !== 'string')) throw new HttpError(400, `${path}.reasonCodes must be an array of strings.`, { field: `${path}.reasonCodes` }, 'INVALID_RECOMMENDATION_REASON_CODES');
  return {
    type: readRecoType(value.type, `${path}.type`),
    providerRefs: validateProviderRefs(value.providerRefs, `${path}.providerRefs`),
    score: readNullableNumber(value.score, `${path}.score`),
    reason: readOptionalString(value.reason ?? null, `${path}.reason`),
    reasonCodes,
    metadata: value.metadata === undefined ? {} : readMetadata(value.metadata, `${path}.metadata`),
  };
}

function readRecoType(value: unknown, path: string): RecoWriteItem['type'] {
  if (typeof value === 'string' && ITEM_TYPES.has(value)) return value as RecoWriteItem['type'];
  throw new HttpError(400, `${path} is unsupported.`, { field: path }, 'INVALID_RECOMMENDATION_ITEM_TYPE');
}

function validateProviderRefs(value: unknown, path: string): RecoWriteItem['providerRefs'] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, `${path} must be a non-empty array.`, { field: path }, 'INVALID_RECOMMENDATION_PROVIDER_REF');
  return value.map((ref, index) => validateProviderRef(ref, `${path}[${index}]`));
}

function validateProviderRef(value: unknown, path: string): { provider: RecoProvider; providerId: string } {
  assertRecord(value, path);
  assertOnlyKeys(value, ['provider', 'providerId'], path);
  if (typeof value.provider !== 'string' || !PROVIDERS.has(value.provider)) throw new HttpError(400, `${path}.provider is unsupported.`, { field: `${path}.provider` }, 'INVALID_RECOMMENDATION_PROVIDER');
  if (typeof value.providerId !== 'string' || !value.providerId.trim()) throw new HttpError(400, `${path}.providerId is required.`, { field: `${path}.providerId` }, 'INVALID_RECOMMENDATION_PROVIDER_ID');
  return { provider: value.provider as RecoProvider, providerId: value.providerId.trim() };
}

function readNullableNumber(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new HttpError(400, `${path} must be a number or null.`, { field: path }, 'INVALID_RECOMMENDATION_SCORE');
}

function readMetadata(value: unknown, path: string): Record<string, unknown> {
  assertRecord(value, path);
  return value;
}

