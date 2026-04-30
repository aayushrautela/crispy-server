import type { AppAuthorizationService } from './app-authorization.service.js';
import type { Clock } from './clock.js';
import type {
  CheckProfileEligibilityInput,
  ProfileEligibility,
  ProfileEligibilityPolicy,
  ProfileEligibilityReason,
} from './profile-eligibility.types.js';
import type { ProfileEligibilityInputs, ProfileEligibilityRepo } from './profile-eligibility.repo.js';
import type { AppPrincipal } from './app-principal.types.js';

export interface ProfileEligibilityService {
  check(input: CheckProfileEligibilityInput): Promise<ProfileEligibility>;
  assertEligible(input: CheckProfileEligibilityInput): Promise<ProfileEligibility>;
  recomputeAndStore(input: {
    principal: AppPrincipal;
    accountId: string;
    profileId: string;
    purpose: 'recommendation-generation';
    reason: string;
  }): Promise<ProfileEligibility>;
}

export class DefaultProfileEligibilityService implements ProfileEligibilityService {
  constructor(
    private readonly deps: {
      repo: ProfileEligibilityRepo;
      appAuthorizationService: AppAuthorizationService;
      clock: Clock;
    },
  ) {}

  async check(input: CheckProfileEligibilityInput): Promise<ProfileEligibility> {
    this.deps.appAuthorizationService.requireScope({ principal: input.principal, scope: 'profiles:eligible:read' });
    this.deps.appAuthorizationService.requireGrant({
      principal: input.principal,
      resourceType: 'profileEligibility',
      resourceId: '*',
      purpose: input.purpose,
      action: 'read',
      accountId: input.accountId,
      profileId: input.profileId,
    });

    const inputs = await this.deps.repo.loadEligibilityInputs({
      accountId: input.accountId,
      profileId: input.profileId,
    });

    if (!inputs) {
      return {
        accountId: input.accountId,
        profileId: input.profileId,
        purpose: input.purpose,
        eligible: false,
        eligibilityVersion: 0,
        reasons: ['profile_inactive'],
        policy: this.buildEmptyPolicy(),
        checkedAt: this.deps.clock.now(),
      };
    }

    return this.evaluatePolicy({ inputs, principal: input.principal, requireAiPersonalization: input.requireAiPersonalization });
  }

  async assertEligible(input: CheckProfileEligibilityInput): Promise<ProfileEligibility> {
    const eligibility = await this.check(input);
    if (!eligibility.eligible) {
      throw new Error(`Profile ${input.profileId} is not eligible: ${eligibility.reasons.join(', ')}`);
    }
    return eligibility;
  }

  async recomputeAndStore(input: {
    principal: AppPrincipal;
    accountId: string;
    profileId: string;
    purpose: 'recommendation-generation';
    reason: string;
  }): Promise<ProfileEligibility> {
    const eligibility = await this.check({
      principal: input.principal,
      accountId: input.accountId,
      profileId: input.profileId,
      purpose: input.purpose,
    });

    const newVersion = await this.deps.repo.incrementEligibilityVersion({
      accountId: input.accountId,
      profileId: input.profileId,
      purpose: input.purpose,
      reason: input.reason,
    });

    await this.deps.repo.upsertEligibilityProjection({
      accountId: input.accountId,
      profileId: input.profileId,
      purpose: input.purpose,
      eligible: eligibility.eligible,
      reasons: eligibility.reasons,
      policy: { ...eligibility.policy },
      eligibilityVersion: newVersion,
      updatedAt: this.deps.clock.now(),
    });

    return { ...eligibility, eligibilityVersion: newVersion };
  }

  private evaluatePolicy(input: {
    inputs: ProfileEligibilityInputs;
    principal: AppPrincipal;
    requireAiPersonalization?: boolean;
  }): ProfileEligibility {
    const reasons: ProfileEligibilityReason[] = [];
    const policy: ProfileEligibilityPolicy = {
      accountActive: input.inputs.accountActive,
      profileActive: input.inputs.profileActive,
      profileDeleted: input.inputs.profileDeleted,
      profileLocked: input.inputs.profileLocked,
      recommendationsEnabled: input.inputs.recommendationsEnabled,
      aiPersonalizationEnabled: input.inputs.aiPersonalizationEnabled,
      accountAllowsPersonalization: input.inputs.accountAllowsPersonalization,
      consentAllowsProcessing: input.inputs.consentAllowsProcessing,
      maturityPolicyAllowsReco: input.inputs.maturityPolicyAllowsReco,
      appGrantAllowsProfile: true,
    };

    if (!input.inputs.accountActive) reasons.push('account_inactive');
    if (!input.inputs.profileActive) reasons.push('profile_inactive');
    if (input.inputs.profileDeleted) reasons.push('profile_deleted');
    if (input.inputs.profileLocked) reasons.push('profile_locked');
    if (!input.inputs.recommendationsEnabled) reasons.push('profile_disabled_recommendations');
    if (input.requireAiPersonalization && !input.inputs.aiPersonalizationEnabled) {
      reasons.push('ai_personalization_disabled');
    }
    if (!input.inputs.accountAllowsPersonalization) reasons.push('account_personalization_disabled');
    if (!input.inputs.consentAllowsProcessing) reasons.push('consent_denied');
    if (!input.inputs.maturityPolicyAllowsReco) reasons.push('maturity_policy_denied');

    const eligible = reasons.length === 0;

    return {
      accountId: input.inputs.accountId,
      profileId: input.inputs.profileId,
      purpose: 'recommendation-generation',
      eligible,
      eligibilityVersion: 0,
      reasons,
      policy,
      checkedAt: this.deps.clock.now(),
    };
  }

  private buildEmptyPolicy(): ProfileEligibilityPolicy {
    return {
      accountActive: false,
      profileActive: false,
      profileDeleted: false,
      profileLocked: false,
      recommendationsEnabled: false,
      aiPersonalizationEnabled: false,
      accountAllowsPersonalization: false,
      consentAllowsProcessing: false,
      maturityPolicyAllowsReco: false,
      appGrantAllowsProfile: false,
    };
  }
}
