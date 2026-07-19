import type { DbClient } from '../../lib/db.js';
import { ProfileLocalService } from '../profiles/profile-local.service.js';
import { HomeListsRepo } from './repos/home-lists.repo.js';
import { getListSource } from './list-sources/list-source.registry.js';
import type { HomeWriteItem, HomeWriteList } from './home-types.js';
import type { ListSourceCtx } from './list-sources/list-source.types.js';
import { normalizeMetadataLanguage } from '../metadata/metadata-language.js';

/** Build the ordered locale-candidate list for fall-through resolution. */
export function localeCandidates(locale: string): string[] {
  const normalized = normalizeMetadataLanguage(locale) ?? 'en';
  const primary = normalized.split('-')[0]?.toLowerCase();
  const candidates = [normalized];
  if (primary && primary !== normalized) {
    candidates.push(primary);
  }
  if (!candidates.includes('en')) {
    candidates.push('en');
  }
  return candidates;
}

type FallbackTemplate = {
  listKey: string;
  locale: string;
  sectionType: string;
  title: string;
  subtitle: string | null;
  rank: number;
  sourceId: string;
  sourceConfig: Record<string, unknown>;
};

/**
 * Resolve fallback templates for a profile into home write lists by invoking the
 * configured list sources. Each template maps to one list; items come from the
 * source fetch. Deterministic; no ML.
 */
export async function buildFallbackLists(
  client: DbClient,
  repo: HomeListsRepo,
  profileId: string,
  templates: FallbackTemplate[],
  ctxBase: Omit<ListSourceCtx, 'client' | 'profileId' | 'limit'>,
  limitsBySection: Record<string, number>,
): Promise<HomeWriteList[]> {
  const lists: HomeWriteList[] = [];
  for (const template of templates) {
    const source = getListSource(template.sourceId);
    if (!source) continue;
    const limit = limitsBySection[template.sectionType] ?? 40;
    const ctx: ListSourceCtx = {
      client,
      profileId,
      ...ctxBase,
      limit,
    };
    let items: HomeWriteItem[] = [];
    try {
      const result = await source.fetchItems(template.sourceConfig as Record<string, unknown>, ctx);
      items = result.items.map((item) => ({
        type: item.type,
        providerRefs: item.providerRefs.map((ref) => ({ provider: ref.provider as 'tmdb' | 'tvdb' | 'imdb' | 'kitsu', providerId: ref.providerId })),
        score: item.score ?? null,
        reason: item.reason ?? null,
        reasonCodes: item.reasonCodes ?? [],
        metadata: item.metadata,
      }));
    } catch (error) {
      console.error(`fallback source ${template.sourceId} failed for ${template.listKey}:`, error);
    }
    lists.push({
      listKey: template.listKey,
      sectionType: template.sectionType as HomeWriteList['sectionType'],
      title: template.title,
      subtitle: template.subtitle ?? null,
      items,
    });
  }
  return lists;
}

/**
 * Pick the best template row per (list_key) across locale candidates, preferring
 * the most specific locale. Returns one template per list_key.
 */
export function resolveTemplatesByLocale(all: FallbackTemplate[], candidates: string[]): FallbackTemplate[] {
  const byKey = new Map<string, FallbackTemplate>();
  const candidateRank = new Map(candidates.map((c, i) => [c, i] as const));
  for (const template of all) {
    const rank = candidateRank.get(template.locale);
    if (rank === undefined) continue;
    const existing = byKey.get(template.listKey);
    if (!existing || (candidateRank.get(existing.locale) ?? Infinity) > rank) {
      byKey.set(template.listKey, template);
    }
  }
  return Array.from(byKey.values());
}

export function profileContextForFallback(
  profile: { interfaceLanguage: string; region: string | null; isKids: boolean },
  connectedProviders: Array<'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'>,
) {
  const locale = profile.interfaceLanguage || 'en';
  const tmdbLanguage = normalizeMetadataLanguage(locale) ?? 'en';
  return {
    locale,
    tmdbLanguage,
    region: profile.region ?? null,
    tmdbRegion: profile.region ?? undefined,
    isKids: profile.isKids,
    connectedProviders,
  };
}

export const FALLBACK_SECTION_LIMITS: Record<string, number> = {
  heroCarousel: 10,
  contentRail: 100,
  categoryTabs: 100,
  collectionRail: 100,
};

export function emptyProfileContext() {
  return { locale: 'en', tmdbLanguage: 'en', region: null, tmdbRegion: undefined, isKids: false, connectedProviders: [] as Array<'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'> };
}

export type { FallbackTemplate };
export { ProfileLocalService };
