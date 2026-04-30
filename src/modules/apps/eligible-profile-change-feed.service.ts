import type { AppAuditRepo } from './app-audit.repo.js';
import type { AppAuthorizationService } from './app-authorization.service.js';
import type { AppCursorCodec } from './app-cursor-codec.js';
import type { Clock } from './clock.js';
import type { ProfileEligibilityService } from './profile-eligibility.service.js';
import type { ProfileEligibility } from './profile-eligibility.types.js';
import type { EligibleProfileChangeFeedRepo } from './eligible-profile-change-feed.repo.js';
import type {
  ListEligibleProfileChangesInput,
  ListEligibleProfileChangesResult,
} from './eligible-profile-change-feed.types.js';

export interface EligibleProfileChangeFeedService {
  listChanges(input: ListEligibleProfileChangesInput): Promise<ListEligibleProfileChangesResult>;
  recordProfileSignalChange(input: { accountId: string; profileId: string; reason: string; signalsVersion: number }): Promise<void>;
  recordEligibilityChange(input: { accountId: string; profileId: string; eligibility: ProfileEligibility; signalsVersion: number }): Promise<void>;
}

export class DefaultEligibleProfileChangeFeedService implements EligibleProfileChangeFeedService {
  constructor(
    private readonly deps: {
      repo: EligibleProfileChangeFeedRepo;
      cursorCodec: AppCursorCodec;
      profileEligibilityService: ProfileEligibilityService;
      appAuthorizationService: AppAuthorizationService;
      appAuditRepo: AppAuditRepo;
      clock: Clock;
      maxLimit: number;
    },
  ) {}

  async listChanges(input: ListEligibleProfileChangesInput): Promise<ListEligibleProfileChangesResult> {
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'profiles:eligible:read' });
    this.deps.appAuthorizationService.requireGrant({
      principal: input.principal,
      resourceType: 'profileEligibility',
      resourceId: '*',
      purpose: 'recommendation-generation',
      action: 'read',
      accountId: input.accountId,
      profileId: input.profileId,
    });

    const limit = Math.min(Math.max(input.limit ?? 100, 1), this.deps.maxLimit);
    const cursorPayload = input.cursor ? this.deps.cursorCodec.decode(input.cursor) : null;
    if (cursorPayload && (cursorPayload.appId !== input.principal.appId || cursorPayload.kind !== 'eligible_profile_changes')) {
      throw new Error('Cursor does not match this app change feed');
    }

    const rows = await this.deps.repo.listChanges({
      appId: input.principal.appId,
      afterSequence: cursorPayload?.sequence ? BigInt(cursorPayload.sequence) : undefined,
      limit: limit + 1,
      reason: input.reason,
      accountId: input.accountId,
      profileId: input.profileId,
    });

    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const hasMore = rows.length > limit;
    const next = hasMore && last
      ? this.deps.cursorCodec.encode({
          appId: input.principal.appId,
          kind: 'eligible_profile_changes',
          sequence: last.sequence.toString(),
          issuedAt: this.deps.clock.now().toISOString(),
        })
      : null;

    await this.deps.appAuditRepo.insert({
      appId: input.principal.appId,
      keyId: input.principal.keyId,
      action: 'eligible_profile_changes_read',
      accountId: input.accountId,
      profileId: input.profileId,
      resourceType: 'profileEligibility',
      resourceId: '*',
      metadata: { count: items.length },
    });

    return { items, cursor: { next, hasMore } };
  }

  async recordProfileSignalChange(input: { accountId: string; profileId: string; reason: string; signalsVersion: number }): Promise<void> {
    await this.deps.repo.appendChange({
      accountId: input.accountId,
      profileId: input.profileId,
      eventType: 'signals_changed',
      eligible: true,
      eligibilityVersion: 0,
      signalsVersion: input.signalsVersion,
      reasons: [input.reason],
      recommendedActions: ['refresh_profile_recommendations'],
      changedAt: this.deps.clock.now(),
    });
  }

  async recordEligibilityChange(input: { accountId: string; profileId: string; eligibility: ProfileEligibility; signalsVersion: number }): Promise<void> {
    await this.deps.repo.appendChange({
      accountId: input.accountId,
      profileId: input.profileId,
      eventType: 'eligibility_changed',
      eligible: input.eligibility.eligible,
      eligibilityVersion: input.eligibility.eligibilityVersion,
      signalsVersion: input.signalsVersion,
      reasons: input.eligibility.reasons,
      recommendedActions: input.eligibility.eligible ? ['refresh_profile_recommendations'] : ['remove_service_recommendations'],
      changedAt: this.deps.clock.now(),
    });
  }
}
