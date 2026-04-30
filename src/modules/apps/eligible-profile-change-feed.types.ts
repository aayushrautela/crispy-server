import type { AppPrincipal } from './app-principal.types.js';

export type EligibleProfileChangeEventType =
  | 'initial'
  | 'profile_updated'
  | 'signals_changed'
  | 'consent_changed'
  | 'settings_changed'
  | 'eligibility_changed'
  | 'account_changed';

export interface EligibleProfileChangeEvent {
  changeId: string;
  accountId: string;
  profileId: string;
  eventType: EligibleProfileChangeEventType;
  eligible: boolean;
  eligibilityVersion: number;
  signalsVersion: number;
  changedAt: Date;
  reasons: string[];
  recommendedActions: string[];
}

export interface ListEligibleProfileChangesInput {
  principal: AppPrincipal;
  cursor?: string;
  limit?: number;
  reason?: EligibleProfileChangeEventType;
  accountId?: string;
  profileId?: string;
}

export interface ListEligibleProfileChangesResult {
  items: EligibleProfileChangeEvent[];
  cursor: { next?: string | null; hasMore: boolean };
}
