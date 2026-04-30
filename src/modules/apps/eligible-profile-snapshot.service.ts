import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { AppCursorCodec } from './app-cursor-codec.js';
import type { Clock } from './clock.js';
import type { EligibleProfileSnapshotRepo } from './eligible-profile-snapshot.repo.js';
import type {
  CreateEligibleProfileSnapshotRequest,
  EligibleProfileSnapshot,
  EligibleProfileSnapshotItem,
  EligibleProfileSnapshotService,
} from './eligible-profile-snapshot.types.js';
import type { AppPrincipal } from './app-principal.types.js';

export class DefaultEligibleProfileSnapshotService implements EligibleProfileSnapshotService {
  constructor(
    private readonly deps: {
      repo: EligibleProfileSnapshotRepo;
      cursorCodec: AppCursorCodec;
      appAuthorizationService: AppAuthorizationService;
      appAuditRepo: AppAuditRepo;
      clock: Clock;
      maxSnapshotCreateLimit: number;
      maxSnapshotReadLimit: number;
    },
  ) {}

  async createSnapshot(input: {
    principal: AppPrincipal;
    request: CreateEligibleProfileSnapshotRequest;
  }): Promise<{ snapshot: EligibleProfileSnapshot }> {
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'profiles:eligible:snapshot:create' });
    this.deps.appAuthorizationService.requireGrant({
      principal: input.principal,
      resourceType: 'profileEligibility',
      resourceId: '*',
      purpose: input.request.purpose,
      action: 'create',
    });

    const snapshot = await this.deps.repo.createSnapshot({
      appId: input.principal.appId,
      purpose: input.request.purpose,
      status: 'active',
      filters: input.request.filters ?? {},
      reason: input.request.reason,
      requestedBy: input.request.requestedBy ?? null,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.appAuditRepo.insert({
      appId: input.principal.appId,
      keyId: input.principal.keyId,
      action: 'eligible_profile_snapshot_created',
      resourceType: 'profileEligibility',
      resourceId: snapshot.snapshotId,
      metadata: { estimatedProfileCount: snapshot.estimatedProfileCount },
    });

    return { snapshot };
  }

  async listItems(input: {
    principal: AppPrincipal;
    snapshotId: string;
    cursor?: string;
    limit?: number;
    leaseSeconds?: number;
  }): Promise<{
    snapshot: EligibleProfileSnapshot;
    items: EligibleProfileSnapshotItem[];
    cursor: { next?: string | null; hasMore: boolean };
  }> {
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'profiles:eligible:snapshot:read' });
    this.deps.appAuthorizationService.requireGrant({
      principal: input.principal,
      resourceType: 'profileEligibility',
      resourceId: '*',
      purpose: 'recommendation-generation',
      action: 'read',
    });

    const snapshot = await this.deps.repo.getSnapshot(input.snapshotId);
    if (!snapshot || snapshot.appId !== input.principal.appId) {
      throw new Error('Eligible profile snapshot not found');
    }

    const cursorPayload = input.cursor ? this.deps.cursorCodec.decode(input.cursor) : null;
    if (cursorPayload && (
      cursorPayload.appId !== input.principal.appId ||
      cursorPayload.kind !== 'eligible_profile_snapshot_items' ||
      cursorPayload.snapshotId !== input.snapshotId
    )) {
      throw new Error('Cursor does not match this app snapshot');
    }

    const limit = Math.min(Math.max(input.limit ?? 100, 1), this.deps.maxSnapshotReadLimit);
    const items = await this.deps.repo.listAndLeaseItems({
      snapshotId: input.snapshotId,
      appId: input.principal.appId,
      afterOffset: cursorPayload?.offset,
      limit: limit + 1,
      leaseSeconds: input.leaseSeconds,
      now: this.deps.clock.now(),
    });

    const returnedItems = items.slice(0, limit);
    const hasMore = items.length > limit;
    const nextOffset = cursorPayload?.offset === undefined
      ? returnedItems.length - 1
      : cursorPayload.offset + returnedItems.length;
    const next = hasMore
      ? this.deps.cursorCodec.encode({
          appId: input.principal.appId,
          kind: 'eligible_profile_snapshot_items',
          snapshotId: input.snapshotId,
          offset: nextOffset,
          issuedAt: this.deps.clock.now().toISOString(),
        })
      : null;

    await this.deps.appAuditRepo.insert({
      appId: input.principal.appId,
      keyId: input.principal.keyId,
      action: 'eligible_profile_snapshot_items_claimed',
      resourceType: 'profileEligibility',
      resourceId: input.snapshotId,
      metadata: { count: returnedItems.length },
    });

    return { snapshot, items: returnedItems, cursor: { next, hasMore } };
  }
}
