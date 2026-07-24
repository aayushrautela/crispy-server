import { normalizeMetadataLanguage } from '../../metadata/metadata-language.js';

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

export type FallbackLocaleMode = 'auto' | 'specific' | 'en';

export type FallbackTemplate = {
  listKey: string;
  locale: string;
  localeMode: FallbackLocaleMode;
  regionOverride: string | null;
  sectionType: string;
  title: string;
  subtitle: string | null;
  rank: number;
  sourceId: string;
  sourceConfig: Record<string, unknown>;
};

/**
 * Pick the best template row per (list_key) across locale candidates, preferring
 * the most specific locale. For auto-mode rows (locale_mode='auto'), the row
 * matches every viewer locale and ranks below any specific match for that locale.
 * Returns one template per list_key.
 */
export function resolveTemplatesByLocale(all: FallbackTemplate[], candidates: string[]): FallbackTemplate[] {
  const byKey = new Map<string, FallbackTemplate>();
  const candidateRank = new Map(candidates.map((c, i) => [c, i] as const));
  for (const template of all) {
    let rank: number | undefined;
    if (template.localeMode === 'auto') {
      rank = candidates.length;
    } else {
      rank = candidateRank.get(template.locale);
    }
    if (rank === undefined) continue;
    const existing = byKey.get(template.listKey);
    if (!existing || (candidateRank.get(existing.locale) ?? candidates.length + 1) > rank) {
      byKey.set(template.listKey, template);
    }
  }
  return Array.from(byKey.values());
}

/**
 * Resolve the active fallback templates for a given viewer locale. Auto-mode
 * rows are included for every viewer; specific/en rows only when their locale
 * is in the candidate chain.
 */
export function resolveFallbackTemplatesForViewer(all: FallbackTemplate[], viewerLocale: string): FallbackTemplate[] {
  const candidates = localeCandidates(viewerLocale);
  return resolveTemplatesByLocale(all, candidates);
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
  contentRail: 50,
  categoryTabs: 50,
  collectionRail: 50,
};

export function emptyProfileContext() {
  return { locale: 'en', tmdbLanguage: 'en', region: null, tmdbRegion: undefined, isKids: false, connectedProviders: [] as Array<'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'> };
}
