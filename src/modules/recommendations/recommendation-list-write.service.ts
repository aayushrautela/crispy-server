import { createHash } from 'crypto';
import { HttpError } from '../../lib/errors.js';
import type { AppAuditRepo } from '../apps/app-audit.repo.js';
import type { RecommendationListWritePolicy } from './recommendation-list-policy.js';
import type { RecommendationListRepo } from './recommendation-list.repo.js';
import type { RecommendationListWriteInput, RecommendationListWriteResult, RecommendationWriteActor } from './recommendation-list.types.js';

export interface RecommendationListWriteService {
  writeList(input: RecommendationListWriteInput): Promise<RecommendationListWriteResult>;
  clearList(input: { accountId: string; profileId: string; listKey: string; source: string; idempotencyKey: string; actor: RecommendationWriteActor }): Promise<RecommendationListWriteResult>;
}

export interface Clock { now(): Date }

export class DefaultRecommendationListWriteService implements RecommendationListWriteService {
  constructor(private readonly deps: { repo: RecommendationListRepo; policy: RecommendationListWritePolicy; appAuditRepo?: AppAuditRepo; clock: Clock }) {}

  async writeList(input: RecommendationListWriteInput): Promise<RecommendationListWriteResult> {
    if (!input.idempotencyKey) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    if (input.writeMode !== 'replace') throw new HttpError(400, 'Only replace writeMode is supported.', undefined, 'UNSUPPORTED_WRITE_MODE');
    const actorKey = this.buildActorKey(input.actor);
    const operationKey = this.buildOperationKey(input);
    const requestHash = this.hashRequest(input);
    const existing = await this.deps.repo.findIdempotencyRecord({ actorKey, operationKey, idempotencyKey: input.idempotencyKey });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new HttpError(409, 'Idempotency-Key was reused with a different request.', undefined, 'IDEMPOTENCY_CONFLICT');
      return { ...existing.responseBody, status: 'idempotent_replay', idempotency: { key: input.idempotencyKey, replayed: true } };
    }
    const decision = await this.deps.policy.authorize(input);
    if (!decision.allowed) throw new HttpError(403, decision.rejectReason ?? 'Recommendation write denied.', undefined, 'RECOMMENDATION_WRITE_DENIED');
    await this.deps.policy.validateListKey({ listKey: input.listKey, source: decision.source, actor: input.actor });
    await this.deps.policy.validateItems({ listKey: input.listKey, source: decision.source, items: input.items, maxItems: decision.maxItems });
    const now = this.deps.clock.now();
    const version = await this.deps.repo.createListVersion({ ...input, source: decision.source, createdAt: now });
    await this.deps.repo.replaceActiveVersion({ accountId: input.accountId, profileId: input.profileId, listKey: input.listKey, source: decision.source, version: version.version, updatedAt: now });
    const result: RecommendationListWriteResult = { accountId: input.accountId, profileId: input.profileId, listKey: input.listKey, source: decision.source, version: version.version, status: 'written', itemCount: version.itemCount, idempotency: { key: input.idempotencyKey, replayed: false }, createdAt: now };
    await this.deps.repo.saveIdempotencyRecord({ actorKey, operationKey, idempotencyKey: input.idempotencyKey, requestHash, responseBody: result, createdAt: now });
    if (input.actor.type === 'app' && this.deps.appAuditRepo) {
      await this.deps.appAuditRepo.insert({ appId: input.actor.appId, keyId: input.actor.keyId, action: 'service_recommendation_list_written', accountId: input.accountId, profileId: input.profileId, resourceType: 'recommendationList', resourceId: input.listKey, runId: input.runId ?? null, batchId: input.batchId ?? null, metadata: { source: decision.source, version: version.version, itemCount: version.itemCount } });
    }
    return result;
  }

  async clearList(input: { accountId: string; profileId: string; listKey: string; source: string; idempotencyKey: string; actor: RecommendationWriteActor }): Promise<RecommendationListWriteResult> {
    const now = this.deps.clock.now();
    return this.deps.repo.clearActiveList({ ...input, clearedAt: now });
  }

  private buildOperationKey(input: RecommendationListWriteInput): string {
    return `${input.accountId}:${input.profileId}:${input.source}:${input.listKey}:${input.writeMode}`;
  }

  private buildActorKey(actor: RecommendationWriteActor): string {
    return actor.type === 'app' ? `app:${actor.appId}:${actor.keyId}` : `account:${actor.accountId}:${actor.userId ?? 'unknown'}`;
  }

  private hashRequest(input: RecommendationListWriteInput): string {
    return createHash('sha256').update(JSON.stringify({ ...input, idempotencyKey: undefined })).digest('hex');
  }
}
