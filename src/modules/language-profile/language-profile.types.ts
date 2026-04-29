export interface LanguageRatio {
  language: string;
  ratio: number;
  count: number;
}

export type LanguageProfileStatus = 'pending' | 'ready' | 'empty';

export interface ProfileLanguageProfile {
  profileId: string;
  status: LanguageProfileStatus;
  windowSize: number;
  sampleSize: number;
  ratios: LanguageRatio[];
  primaryLanguage: string | null;
  computedAt: string | null;
}
