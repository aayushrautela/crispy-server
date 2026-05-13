export const PUBLIC_ACCOUNT_WRITE_SOURCE = 'account_api' as const;
export const PUBLIC_TASTE_MAX_SIGNALS = 250;
export const PUBLIC_TASTE_MAX_SUMMARY_LENGTH = 2000;
export const PUBLIC_TASTE_MAX_SIGNAL_LABEL_LENGTH = 200;
export const PUBLIC_TASTE_MAX_SIGNAL_KEY_LENGTH = 200;
export const PUBLIC_WRITE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export type PublicAccountWriteSource = typeof PUBLIC_ACCOUNT_WRITE_SOURCE;
export type PublicTasteSignalKind = 'genre' | 'artist' | 'track' | 'album' | 'playlist' | 'mood' | 'activity' | 'language' | 'era' | 'tag';

export interface PublicTasteSignalInput {
  kind: PublicTasteSignalKind;
  key?: string;
  provider?: string;
  providerItemId?: string;
  label?: string;
  weight: number;
  confidence?: number;
}

export interface ReplacePublicTasteProfileRequest {
  summary?: string;
  locale?: string;
  signals: PublicTasteSignalInput[];
  clientContext?: Record<string, unknown>;
}

export interface PublicTasteWriteResponse {
  profileId: string;
  source: PublicAccountWriteSource;
  version: number;
  signalCount: number;
  created: boolean;
  updatedAt: string;
  etag: string;
}
