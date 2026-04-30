import type { AppPrincipal } from './app-principal.types.js';

export type ProfileEligibilityReason =
  | 'account_inactive'
  | 'profile_inactive'
  | 'profile_deleted'
  | 'profile_locked'
  | 'profile_disabled_recommendations'
  | 'ai_personalization_disabled'
  | 'account_personalization_disabled'
  | 'consent_denied'
  | 'maturity_policy_denied'
  | 'privacy_policy_denied'
  | 'app_grant_denied';

export interface ProfileEligibilityPolicy {
  accountActive: boolean;
  profileActive: boolean;
  profileDeleted: boolean;
  profileLocked: boolean;
  recommendationsEnabled: boolean;
  aiPersonalizationEnabled: boolean;
  accountAllowsPersonalization: boolean;
  consentAllowsProcessing: boolean;
  maturityPolicyAllowsReco: boolean;
  appGrantAllowsProfile: boolean;
}

export interface ProfileEligibility {
  accountId: string;
  profileId: string;
  purpose: 'recommendation-generation';
  eligible: boolean;
  eligibilityVersion: number;
  reasons: ProfileEligibilityReason[];
  policy: ProfileEligibilityPolicy;
  checkedAt: Date;
}

export interface CheckProfileEligibilityInput {
  principal: AppPrincipal;
  accountId: string;
  profileId: string;
  purpose: 'recommendation-generation';
  requireAiPersonalization?: boolean;
}
