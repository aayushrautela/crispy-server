import { HttpError } from '../../lib/errors.js';
import type { HomeSectionType, HomeSource, HomeWriteActor, HomeWriteItem } from './home-types.js';

export interface HomeWritePolicy {
  authorize(input: { actor: HomeWriteActor; source: HomeSource }): { allowed: boolean; rejectReason?: string };
  validateListKey(listKey: string): void;
  validateSection(sectionType: HomeSectionType, items: HomeWriteItem[]): void;
}

const SOURCE_TO_MAX_ITEMS: Record<HomeSource, number> = {
  custom: 100,
  reco: 100,
  fallback: 100,
};

const SECTIONS_REQUIRING_ITEMS: ReadonlySet<HomeSectionType> = new Set([
  'categoryTabs',
  'heroCarousel',
  'contentRail',
  'collectionRail',
]);

export class DefaultHomeWritePolicy implements HomeWritePolicy {
  authorize(input: { actor: HomeWriteActor; source: HomeSource }): { allowed: boolean; rejectReason?: string } {
    if (input.source === 'custom') {
      if (input.actor.type !== 'account') {
        return { allowed: false, rejectReason: 'custom source requires an account actor.' };
      }
      return { allowed: true };
    }
    if (input.source === 'reco' || input.source === 'fallback') {
      if (input.actor.type !== 'app') {
        return { allowed: false, rejectReason: `${input.source} source requires an app actor.` };
      }
      return { allowed: true };
    }
    return { allowed: false, rejectReason: 'Unknown home source.' };
  }

  validateListKey(listKey: string): void {
    if (typeof listKey !== 'string' || !listKey.trim()) {
      throw new HttpError(400, 'listKey is required.', { field: 'listKey' }, 'INVALID_LIST_KEY');
    }
  }

  validateSection(sectionType: HomeSectionType, items: HomeWriteItem[]): void {
    if (!Array.isArray(items)) throw new HttpError(400, 'items must be an array.', undefined, 'INVALID_ITEMS');
    const maxItems = SOURCE_TO_MAX_ITEMS.reco;
    if (items.length > maxItems) throw new HttpError(400, `items exceeds max of ${maxItems}.`, undefined, 'TOO_MANY_ITEMS');
    if (SECTIONS_REQUIRING_ITEMS.has(sectionType) && items.length === 0) {
      throw new HttpError(400, `${sectionType} requires at least one item.`, undefined, 'INVALID_ITEMS');
    }
    const ranks = new Set<number>();
    items.forEach((item, index) => {
      const rank = item.rank ?? index + 1;
      if (!Number.isInteger(rank) || rank < 1) throw new HttpError(400, 'Each item requires positive integer rank.', undefined, 'INVALID_ITEM_RANK');
      if (ranks.has(rank)) throw new HttpError(400, 'Duplicate item rank.', undefined, 'DUPLICATE_ITEM_RANK');
      ranks.add(rank);
    });
  }
}
