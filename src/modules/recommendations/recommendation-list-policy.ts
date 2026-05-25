import { HttpError } from '../../lib/errors.js';
import { OFFICIAL_RECOMMENDER_APP_ID } from '../apps/official-recommender-lists.js';
import type { AppSourceOwnershipRepo } from '../apps/app-source-ownership.repo.js';
import type { RecommendationListItemInput, RecommendationListPolicyDecision, RecommendationListWriteInput, RecommendationWriteActor } from './recommendation-list.types.js';

export interface RecommendationListWritePolicy {
  authorize(input: RecommendationListWriteInput): Promise<RecommendationListPolicyDecision>;
  validateListKey(input: { listKey: string; source: string; actor: RecommendationWriteActor }): Promise<void>;
  validateItems(input: { listKey: string; source: string; sectionType: RecommendationListWriteInput['sectionType']; items: RecommendationListItemInput[]; maxItems: number }): Promise<void>;
}

export interface PublicListKeyValidator {
  validate(listKey: string): void | Promise<void>;
}

export class PublicRecommendationWritePolicy implements RecommendationListWritePolicy {
  constructor(private readonly deps: { publicListKeyValidator: PublicListKeyValidator; maxPublicItems: number }) {}

  async authorize(input: RecommendationListWriteInput): Promise<RecommendationListPolicyDecision> {
    if (input.actor.type !== 'account' || input.source !== 'account_api') {
      return { allowed: false, source: 'account_api', maxItems: this.deps.maxPublicItems, requiresEligibilityAtWrite: false, rejectReason: 'Public recommendation writes must use account_api source.' };
    }
    await this.validateListKey({ listKey: input.listKey, source: input.source, actor: input.actor });
    return { allowed: true, source: 'account_api', maxItems: this.deps.maxPublicItems, requiresEligibilityAtWrite: false };
  }

  async validateListKey(input: { listKey: string; source: string; actor: RecommendationWriteActor }): Promise<void> {
    await this.deps.publicListKeyValidator.validate(input.listKey);
  }

  async validateItems(input: { listKey: string; source: string; sectionType: RecommendationListWriteInput['sectionType']; items: RecommendationListItemInput[]; maxItems: number }): Promise<void> {
    validateRecommendationItems(input.items, input.maxItems, input.sectionType);
  }
}

export class AppRecommendationWritePolicy implements RecommendationListWritePolicy {
  constructor(private readonly deps: {
    sourceOwnershipRepo: AppSourceOwnershipRepo;
    maxItemsDefault: number;
  }) {}

  async authorize(input: RecommendationListWriteInput): Promise<RecommendationListPolicyDecision> {
    if (input.actor.type !== 'app') {
      return { allowed: false, source: input.source, maxItems: this.deps.maxItemsDefault, requiresEligibilityAtWrite: true, rejectReason: 'App actor is required.' };
    }
    if (input.actor.appId !== OFFICIAL_RECOMMENDER_APP_ID) {
      await this.deps.sourceOwnershipRepo.assertAppOwnsListKey({ appId: input.actor.appId, source: input.source, listKey: input.listKey });
    }
    return { allowed: true, source: input.source, maxItems: this.deps.maxItemsDefault, requiresEligibilityAtWrite: true };
  }

  async validateListKey(input: { listKey: string; source: string; actor: RecommendationWriteActor }): Promise<void> {
    if (input.actor.type !== 'app') throw new HttpError(403, 'App actor is required.', undefined, 'APP_ACTOR_REQUIRED');
    if (input.actor.appId !== OFFICIAL_RECOMMENDER_APP_ID) {
      await this.deps.sourceOwnershipRepo.assertAppOwnsListKey({ appId: input.actor.appId, source: input.source, listKey: input.listKey });
    }
  }

  async validateItems(input: { listKey: string; source: string; sectionType: RecommendationListWriteInput['sectionType']; items: RecommendationListItemInput[]; maxItems: number }): Promise<void> {
    validateRecommendationItems(input.items, input.maxItems, input.sectionType);
  }
}

export function validateRecommendationItems(items: RecommendationListItemInput[], maxItems: number, sectionType: RecommendationListWriteInput['sectionType'] = 'contentRail'): void {
  if (!Array.isArray(items)) throw new HttpError(400, 'items must be an array.', undefined, 'INVALID_ITEMS');
  if (items.length > maxItems) throw new HttpError(400, `items exceeds max of ${maxItems}.`, undefined, 'TOO_MANY_ITEMS');
  if ((sectionType === 'categoryTabs' || sectionType === 'heroCarousel' || sectionType === 'contentRail' || sectionType === 'collectionRail') && items.length === 0) throw new HttpError(400, `${sectionType} requires at least one item.`, undefined, 'INVALID_ITEMS');
  const ranks = new Set<number>();
  for (const item of items) {
    if (!item.itemId || typeof item.itemId !== 'string') throw new HttpError(400, 'Each item requires itemId.', undefined, 'INVALID_ITEM_ID');
    if (!Number.isInteger(item.rank) || item.rank < 1) throw new HttpError(400, 'Each item requires positive integer rank.', undefined, 'INVALID_ITEM_RANK');
    if (ranks.has(item.rank)) throw new HttpError(400, 'Duplicate item rank.', undefined, 'DUPLICATE_ITEM_RANK');
    ranks.add(item.rank);
  }
}
