import { HttpError } from '../../lib/errors.js';

export interface SupportedLanguage {
  code: string;
  name: string;
}

const BASE_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ru', name: 'Russian' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'sv', name: 'Swedish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'cs', name: 'Czech' },
  { code: 'sk', name: 'Slovak' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'fa', name: 'Persian' },
  { code: 'ur', name: 'Urdu' },
];

const LANGUAGE_BY_CODE: ReadonlyMap<string, SupportedLanguage> = (() => {
  const map = new Map<string, SupportedLanguage>();
  for (const language of BASE_LANGUAGES) {
    map.set(language.code.toLowerCase(), language);
  }
  return map;
})();

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = BASE_LANGUAGES;

export function isSupportedLanguageCode(code: string): boolean {
  return LANGUAGE_BY_CODE.has(code.toLowerCase());
}

export function normalizeLanguageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().replaceAll('_', '-');
  if (!candidate) return null;
  const lowered = candidate.toLowerCase();
  const match = LANGUAGE_BY_CODE.get(lowered);
  if (!match) return null;
  return match.code;
}

export function requireSupportedLanguage(value: unknown, label = 'Language'): string {
  const normalized = normalizeLanguageCode(value);
  if (!normalized) {
    throw new HttpError(400, `${label} is required and must be a supported language code.`, undefined, 'invalid_language');
  }
  return normalized;
}
