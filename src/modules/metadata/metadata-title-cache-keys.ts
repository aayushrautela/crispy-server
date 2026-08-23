export function metadataTitlePageCacheKey(itemId: string, language?: string | null): string {
  const normalizedLanguage = typeof language === 'string' && language.trim() ? language.trim() : 'default';
  return `meta:v2:title-page:${normalizedLanguage}:${itemId}`;
}

export function metadataTitlePageCacheIndexKey(itemId: string): string {
  return `meta:v2:title-page:index:${itemId}`;
}

export function metadataTitleExtrasCacheKey(itemId: string, language?: string | null): string {
  const normalizedLanguage = typeof language === 'string' && language.trim() ? language.trim() : 'default';
  return `meta:v2:title-extras:${normalizedLanguage}:${itemId}`;
}

export function metadataSeriesEpisodesCacheKey(itemId: string, language?: string | null, season?: number | null): string {
  const normalizedLanguage = typeof language === 'string' && language.trim() ? language.trim() : 'default';
  return `meta:v2:series-episodes:${normalizedLanguage}:${itemId}:${season ?? 'all'}`;
}
