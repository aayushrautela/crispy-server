export function metadataTitlePageCacheKey(mediaKey: string, language?: string | null): string {
  const normalizedLanguage = typeof language === 'string' && language.trim() ? language.trim() : 'default';
  return `meta:v2:title-page:${normalizedLanguage}:${mediaKey}`;
}

export function metadataTitlePageCacheIndexKey(mediaKey: string): string {
  return `meta:v2:title-page:index:${mediaKey}`;
}
