import { HttpError } from '../../lib/errors.js';
import type { HomeWriteItem, HomeWriteList, HomeWriteProviderRef } from '../home/home-types.js';

const PROVIDERS: ReadonlySet<HomeWriteProviderRef['provider']> = new Set(['tmdb', 'tvdb', 'imdb', 'kitsu', 'trakt']);
const ITEM_TYPES: ReadonlySet<HomeWriteItem['type']> = new Set(['movie', 'tv']);
const HOME_SECTION_TYPES: ReadonlySet<HomeWriteList['sectionType']> = new Set(['categoryTabs', 'heroCarousel', 'contentRail', 'collectionRail']);

export type RecoListWriteRequest = {
  lists: HomeWriteList[];
};

export function parseRecoListWriteRequest(body: unknown): RecoListWriteRequest {
  const value = asRecord(body);
  if (!Array.isArray(value.lists)) {
    throw new HttpError(400, 'lists is required.', { field: 'lists' }, 'INVALID_RECO_LIST_WRITE');
  }
  const lists: HomeWriteList[] = value.lists.map((rawList, index) => parseList(rawList, `lists[${index}]`));
  return { lists };
}

function parseList(rawList: unknown, listPath: string): HomeWriteList {
  const list = asRecord(rawList);
  const sectionType = list.sectionType;
  if (typeof sectionType !== 'string' || !HOME_SECTION_TYPES.has(sectionType as HomeWriteList['sectionType'])) {
    throw new HttpError(400, `${listPath}.sectionType is invalid.`, { field: `${listPath}.sectionType` }, 'INVALID_SECTION_TYPE');
  }
  if (typeof list.title !== 'string' || !list.title.trim()) {
    throw new HttpError(400, `${listPath}.title is required.`, { field: `${listPath}.title` }, 'INVALID_TITLE');
  }
  if (!Array.isArray(list.items)) {
    throw new HttpError(400, `${listPath}.items must be an array.`, { field: `${listPath}.items` }, 'INVALID_ITEMS');
  }
  const items: HomeWriteItem[] = list.items.map((rawItem, itemIndex) => parseItem(rawItem, `${listPath}.items[${itemIndex}]`));
  return {
    sectionType: sectionType as HomeWriteList['sectionType'],
    title: list.title,
    subtitle: typeof list.subtitle === 'string' && list.subtitle.trim() ? list.subtitle : null,
    items,
  };
}

function parseItem(rawItem: unknown, itemPath: string): HomeWriteItem {
  const item = asRecord(rawItem);
  const type = item.type;
  if (typeof type !== 'string' || !ITEM_TYPES.has(type as HomeWriteItem['type'])) {
    throw new HttpError(400, `${itemPath}.type must be movie or tv.`, { field: `${itemPath}.type` }, 'INVALID_ITEM_TYPE');
  }
  if (!Array.isArray(item.providerRefs) || item.providerRefs.length === 0) {
    throw new HttpError(400, `${itemPath}.providerRefs is required.`, { field: `${itemPath}.providerRefs` }, 'INVALID_PROVIDER_REF');
  }
  const providerRefs: HomeWriteProviderRef[] = item.providerRefs.map((rawRef, refIndex) => parseProviderRef(rawRef, `${itemPath}.providerRefs[${refIndex}]`));
  const metadata = item.metadata;
  const result: HomeWriteItem = { type: type as HomeWriteItem['type'], providerRefs };
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    result.metadata = metadata as Record<string, unknown>;
  }
  return result;
}

function parseProviderRef(rawRef: unknown, refPath: string): HomeWriteProviderRef {
  const ref = asRecord(rawRef);
  const provider = ref.provider;
  if (typeof provider !== 'string' || !PROVIDERS.has(provider as HomeWriteProviderRef['provider'])) {
    throw new HttpError(400, `${refPath}.provider is unsupported.`, { field: `${refPath}.provider` }, 'INVALID_RECOMMENDATION_PROVIDER');
  }
  if (typeof ref.providerId !== 'string' || !ref.providerId.trim()) {
    throw new HttpError(400, `${refPath}.providerId is required.`, { field: `${refPath}.providerId` }, 'INVALID_PROVIDER_ID');
  }
  return { provider: provider as HomeWriteProviderRef['provider'], providerId: ref.providerId };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
