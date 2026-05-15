const LANGUAGE_REGEX = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

export function normalizeMetadataLanguage(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().replaceAll('_', '-');
  if (!LANGUAGE_REGEX.test(trimmed)) return null;
  const parts = trimmed.split('-');
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 2) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join('-');
}

export function resolveEffectiveMetadataLanguage(
  explicitLanguage?: string | null,
  profileLanguage?: string | null,
  accountLanguage?: string | null,
): string {
  return explicitLanguage ?? profileLanguage ?? accountLanguage ?? 'en';
}

export function toTmdbLanguageQuery(language: string | null): string | undefined {
  return language ?? undefined;
}

export function buildTmdbIncludeImageLanguage(language: string | null): string {
  return language ? `null,${language}` : 'null,en';
}
