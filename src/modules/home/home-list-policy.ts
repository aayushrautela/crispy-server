import { HttpError } from '../../lib/errors.js';
import type { HomeSectionType, HomeSource, HomeWriteActor, HomeWriteItem } from './home-types.js';

export interface HomeWritePolicy {
  authorize(input: { actor: HomeWriteActor; source: HomeSource }): { allowed: boolean; rejectReason?: string };
  validateSection(sectionType: HomeSectionType, items: HomeWriteItem[]): void;
}

const MAX_ITEMS_PER_LIST = 100;

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

  validateSection(sectionType: HomeSectionType, items: HomeWriteItem[]): void {
    if (!Array.isArray(items)) throw new HttpError(400, 'items must be an array.', undefined, 'INVALID_ITEMS');
    if (items.length > MAX_ITEMS_PER_LIST) throw new HttpError(400, `items exceeds max of ${MAX_ITEMS_PER_LIST}.`, undefined, 'TOO_MANY_ITEMS');
    if (SECTIONS_REQUIRING_ITEMS.has(sectionType) && items.length === 0) {
      throw new HttpError(400, `${sectionType} requires at least one item.`, undefined, 'INVALID_ITEMS');
    }
  }
}
