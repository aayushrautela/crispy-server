import * as crypto from 'node:crypto';
import type {
  ProfileInputContinueWatchingItem,
  ProfileInputRatingItem,
  ProfileInputTrackedSeriesItem,
  ProfileInputWatchHistoryItem,
  ProfileInputWatchlistItem,
} from './profile-input-signal.types.js';
import type { ProfileInputSignalCacheRepo } from './profile-input-signal-cache.repo.js';
import type {
  ProfileInputSignalCacheDiagnostics,
  ProfileInputSignalCacheFamilyDecision,
  ProfileInputSignalCacheFamilyRequest,
  ProfileInputSignalCachePolicy,
  ProfileInputSignalCacheSection,
  ProfileInputSignalCacheSectionPayload,
  ProfileInputSignalCacheWriteSection,
  ProfileInputSignalFamily,
  ProfileInputSignalSourceMode,
} from './profile-input-signal-cache.types.js';

export interface CacheLogger {
  logCacheDecision?(input: { accountId: string; profileId: string; reason: string; families: ProfileInputSignalFamily[] }): void;
  logCacheRead?(input: {
    accountId: string;
    profileId: string;
    decisions: ProfileInputSignalCacheFamilyDecision[];
    cacheHits: number;
    liveFallbacks: number;
  }): void;
  logCacheWrite?(input: { accountId: string; profileId: string; families: ProfileInputSignalFamily[]; success: boolean }): void;
  logCacheError?(input: { accountId: string; profileId: string; operation: string; error: string }): void;
}

export class ProfileInputSignalCacheService {
  constructor(private readonly deps: { repo: ProfileInputSignalCacheRepo; policy: ProfileInputSignalCachePolicy; logger?: CacheLogger }) {}

  get policy(): ProfileInputSignalCachePolicy {
    return this.deps.policy;
  }

  private isRolloutSelected(accountId: string, profileId: string): boolean {
    if (this.deps.policy.readRolloutPercent >= 100) return true;
    if (this.deps.policy.readRolloutPercent <= 0) return false;
    const hash = crypto.createHash('sha256').update(`${accountId}:${profileId}`).digest();
    const hashValue = hash.readUInt32BE(0);
    const bucket = (hashValue % 100) + 1;
    return bucket <= this.deps.policy.readRolloutPercent;
  }

  async readUsableSections(input: {
    accountId: string;
    profileId: string;
    requests: ProfileInputSignalCacheFamilyRequest[];
    now: Date;
  }): Promise<{
    payload: ProfileInputSignalCacheSectionPayload;
    liveRequests: ProfileInputSignalCacheFamilyRequest[];
    diagnostics: Omit<ProfileInputSignalCacheDiagnostics, 'sourceMode' | 'generatedAt' | 'cacheWriteAttempted' | 'cacheWriteError'>;
  }> {
    const policy = this.deps.policy;
    const baseDiagnostics = {
      schemaVersion: policy.schemaVersion,
      decisions: [] as ProfileInputSignalCacheFamilyDecision[],
      cacheReadAttempted: false,
    };

    if (policy.forceLive) {
      this.logCacheDecision({ accountId: input.accountId, profileId: input.profileId, reason: 'force_live', families: input.requests.map((r) => r.family) });
      return {
        payload: {},
        liveRequests: input.requests,
        diagnostics: {
          ...baseDiagnostics,
          decisions: input.requests.map((request) => ({ family: request.family, source: 'live', reason: 'force_live' })),
        },
      };
    }

    if (!policy.readEnabled) {
      this.logCacheDecision({ accountId: input.accountId, profileId: input.profileId, reason: 'cache_read_disabled', families: input.requests.map((r) => r.family) });
      return {
        payload: {},
        liveRequests: input.requests,
        diagnostics: {
          ...baseDiagnostics,
          decisions: input.requests.map((request) => ({ family: request.family, source: 'live', reason: 'cache_read_disabled' })),
        },
      };
    }

    if (!this.isRolloutSelected(input.accountId, input.profileId)) {
      this.logCacheDecision({ accountId: input.accountId, profileId: input.profileId, reason: 'rollout_not_selected', families: input.requests.map((r) => r.family) });
      return {
        payload: {},
        liveRequests: input.requests,
        diagnostics: {
          ...baseDiagnostics,
          decisions: input.requests.map((request) => ({ family: request.family, source: 'live', reason: 'rollout_not_selected' })),
        },
      };
    }

    const allowedRequests = input.requests.filter((request) => this.isFamilyAllowed(request.family));
    const disallowedDecisions = input.requests
      .filter((request) => !this.isFamilyAllowed(request.family))
      .map((request): ProfileInputSignalCacheFamilyDecision => ({ family: request.family, source: 'live', reason: 'family_not_allowed' }));

    if (allowedRequests.length === 0) {
      return {
        payload: {},
        liveRequests: input.requests,
        diagnostics: { ...baseDiagnostics, decisions: disallowedDecisions },
      };
    }

    let sections: ProfileInputSignalCacheSection[];
    try {
      sections = await this.deps.repo.getSections({
        accountId: input.accountId,
        profileId: input.profileId,
        families: allowedRequests.map((request) => request.family),
        schemaVersion: policy.schemaVersion,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'cache read failed';
      this.logCacheError({ accountId: input.accountId, profileId: input.profileId, operation: 'read', error: errorMsg });
      return {
        payload: {},
        liveRequests: input.requests,
        diagnostics: {
          ...baseDiagnostics,
          cacheReadAttempted: true,
          cacheReadError: errorMsg,
          decisions: input.requests.map((request) => ({ family: request.family, source: 'live', reason: 'cache_unavailable' })),
        },
      };
    }

    const byFamily = new Map(sections.map((section) => [section.family, section]));
    const payload: ProfileInputSignalCacheSectionPayload = {};
    const liveRequests: ProfileInputSignalCacheFamilyRequest[] = [];
    const decisions: ProfileInputSignalCacheFamilyDecision[] = [...disallowedDecisions];

    for (const request of allowedRequests) {
      const section = byFamily.get(request.family);
      const decision = this.validateSection(section, request, input.now);
      decisions.push(decision);
      if (decision.source === 'cache' && section) {
        Object.assign(payload, section.payload as ProfileInputSignalCacheSectionPayload);
      } else {
        liveRequests.push(request);
      }
    }

    liveRequests.push(...input.requests.filter((request) => !this.isFamilyAllowed(request.family)));

    this.logCacheRead({
      accountId: input.accountId,
      profileId: input.profileId,
      decisions,
      cacheHits: decisions.filter((d) => d.source === 'cache').length,
      liveFallbacks: decisions.filter((d) => d.source === 'live').length,
    });

    if (policy.observeOnly) {
      return {
        payload: {},
        liveRequests: input.requests,
        diagnostics: {
          ...baseDiagnostics,
          cacheReadAttempted: true,
          decisions: decisions.map((decision) =>
            decision.source === 'cache' ? { ...decision, source: 'live', reason: 'observe_only' } : decision,
          ),
        },
      };
    }

    return {
      payload,
      liveRequests,
      diagnostics: { ...baseDiagnostics, cacheReadAttempted: true, decisions },
    };
  }

  async writeSections(input: {
    accountId: string;
    profileId: string;
    requests: ProfileInputSignalCacheFamilyRequest[];
    payload: ProfileInputSignalCacheSectionPayload;
    now: Date;
  }): Promise<{ attempted: boolean; error?: string }> {
    if (!this.deps.policy.writeEnabled || input.requests.length === 0) return { attempted: false };

    const sections = input.requests.map((request) => this.buildWriteSection(request, input.payload, input.now));

    try {
      await this.deps.repo.upsertSections({
        accountId: input.accountId,
        profileId: input.profileId,
        schemaVersion: this.deps.policy.schemaVersion,
        sections,
        generationReason: 'read_through',
      });
      this.logCacheWrite({
        accountId: input.accountId,
        profileId: input.profileId,
        families: sections.map((s) => s.family),
        success: true,
      });
      return { attempted: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'cache write failed';
      this.logCacheError({ accountId: input.accountId, profileId: input.profileId, operation: 'write', error: errorMsg });
      return { attempted: true, error: errorMsg };
    }
  }

  resolveSourceMode(input: {
    decisions: ProfileInputSignalCacheFamilyDecision[];
    cacheWriteAttempted: boolean;
  }): ProfileInputSignalSourceMode {
    if (this.deps.policy.forceLive) return 'force_live';
    const cacheCount = input.decisions.filter((decision) => decision.source === 'cache').length;
    const liveCount = input.decisions.filter((decision) => decision.source === 'live').length;
    if (cacheCount > 0 && liveCount === 0) return 'cache';
    if (cacheCount > 0 && liveCount > 0) return 'cache_with_live_fallback';
    if (input.cacheWriteAttempted) return 'live_with_cache_write';
    return 'live';
  }

  private validateSection(
    section: ProfileInputSignalCacheSection | undefined,
    request: ProfileInputSignalCacheFamilyRequest,
    now: Date,
  ): ProfileInputSignalCacheFamilyDecision {
    if (!section) return { family: request.family, source: 'live', reason: 'miss' };
    if (section.schemaVersion !== this.deps.policy.schemaVersion) return { family: request.family, source: 'live', reason: 'schema_mismatch' };
    if (section.invalidatedAt) return { family: request.family, source: 'live', reason: 'invalidated' };
    if (!section.isComplete) return { family: request.family, source: 'live', reason: 'partial_missing_family' };
    if (section.limitCoverage < request.requestedLimit) {
      return { family: request.family, source: 'live', reason: 'insufficient_limit_coverage' };
    }
    if (section.expiresAt && section.expiresAt.getTime() <= now.getTime()) {
      return { family: request.family, source: 'live', reason: 'stale_ttl' };
    }
    if (!this.payloadHasFamily(section.payload, request.family)) {
      return { family: request.family, source: 'live', reason: 'payload_deserialization_failed' };
    }
    if (section.itemCount === 0 && section.emptyKind !== 'known_empty') {
      return { family: request.family, source: 'live', reason: 'partial_missing_family' };
    }
    return {
      family: request.family,
      source: 'cache',
      reason: 'hit_fresh',
      itemCount: section.itemCount,
      cacheAgeMs: Math.max(0, now.getTime() - section.materializedAt.getTime()),
    };
  }

  private buildWriteSection(
    request: ProfileInputSignalCacheFamilyRequest,
    payload: ProfileInputSignalCacheSectionPayload,
    now: Date,
  ): ProfileInputSignalCacheWriteSection {
    const items = this.familyItems(request.family, payload);
    const ttlSeconds = this.deps.policy.ttlSecondsByFamily[request.family];
    const sourceLatestUpdatedAt = this.extractSourceLatestUpdatedAt(items) ?? now;
    return {
      family: request.family,
      payload: this.familyPayload(request.family, items),
      itemCount: items.length,
      limitCoverage: request.requestedLimit,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      sourceVersion: now.getTime(),
      sourceLatestUpdatedAt,
      isComplete: true,
      emptyKind: items.length === 0 ? 'known_empty' : 'not_empty',
    };
  }

  private extractSourceLatestUpdatedAt(items: unknown[]): Date | undefined {
    if (items.length === 0) return undefined;
    let latest: Date | undefined;
    for (const item of items) {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const updatedAt = obj.updatedAt ?? obj.occurredAt ?? obj.addedAt ?? obj.createdAt;
        if (updatedAt instanceof Date) {
          if (!latest || updatedAt > latest) latest = updatedAt;
        } else if (typeof updatedAt === 'string') {
          const parsed = new Date(updatedAt);
          if (!isNaN(parsed.getTime()) && (!latest || parsed > latest)) latest = parsed;
        }
      }
    }
    return latest;
  }

  private logCacheDecision(input: { accountId: string; profileId: string; reason: string; families: ProfileInputSignalFamily[] }): void {
    this.deps.logger?.logCacheDecision?.(input);
  }

  private logCacheRead(input: {
    accountId: string;
    profileId: string;
    decisions: ProfileInputSignalCacheFamilyDecision[];
    cacheHits: number;
    liveFallbacks: number;
  }): void {
    this.deps.logger?.logCacheRead?.(input);
  }

  private logCacheWrite(input: { accountId: string; profileId: string; families: ProfileInputSignalFamily[]; success: boolean }): void {
    this.deps.logger?.logCacheWrite?.(input);
  }

  private logCacheError(input: { accountId: string; profileId: string; operation: string; error: string }): void {
    this.deps.logger?.logCacheError?.(input);
  }

  private isFamilyAllowed(family: ProfileInputSignalFamily): boolean {
    const allowedFamilies = this.deps.policy.allowedFamilies;
    return !allowedFamilies || allowedFamilies.includes(family);
  }

  private payloadHasFamily(payload: unknown, family: ProfileInputSignalFamily): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const sectionPayload = payload as ProfileInputSignalCacheSectionPayload;
    return Array.isArray(this.familyItems(family, sectionPayload));
  }

  private familyItems(family: ProfileInputSignalFamily, payload: ProfileInputSignalCacheSectionPayload): unknown[] {
    switch (family) {
      case 'history':
        return payload.history ?? [];
      case 'ratings':
        return payload.ratings ?? [];
      case 'watchlist':
        return payload.watchlist ?? [];
      case 'continueWatching':
        return payload.continueWatching ?? [];
      case 'trackedSeries':
        return payload.trackedSeries ?? [];
    }
  }

  private familyPayload(family: ProfileInputSignalFamily, items: unknown[]): ProfileInputSignalCacheSectionPayload {
    switch (family) {
      case 'history':
        return { history: items as ProfileInputWatchHistoryItem[] };
      case 'ratings':
        return { ratings: items as ProfileInputRatingItem[] };
      case 'watchlist':
        return { watchlist: items as ProfileInputWatchlistItem[] };
      case 'continueWatching':
        return { continueWatching: items as ProfileInputContinueWatchingItem[] };
      case 'trackedSeries':
        return { trackedSeries: items as ProfileInputTrackedSeriesItem[] };
    }
  }
}
