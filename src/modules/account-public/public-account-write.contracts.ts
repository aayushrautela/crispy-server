export const PUBLIC_ACCOUNT_WRITE_SOURCE = 'account_api' as const;
export const PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION = '2026-04-01' as const;
export const PUBLIC_RECOMMENDATION_MAX_ITEMS = 500;
export const PUBLIC_RECOMMENDATION_MAX_REASON_LENGTH = 512;
export const PUBLIC_RECOMMENDATION_MAX_SUMMARY_LENGTH = 1000;
export const PUBLIC_RECOMMENDATION_MAX_TITLE_LENGTH = 300;
export const PUBLIC_TASTE_MAX_SIGNALS = 250;
export const PUBLIC_TASTE_MAX_SUMMARY_LENGTH = 2000;
export const PUBLIC_TASTE_MAX_SIGNAL_LABEL_LENGTH = 200;
export const PUBLIC_TASTE_MAX_SIGNAL_KEY_LENGTH = 200;
export const PUBLIC_WRITE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export type PublicAccountWriteSource = typeof PUBLIC_ACCOUNT_WRITE_SOURCE;
export type PublicAccountSchemaVersion = typeof PUBLIC_ACCOUNT_WRITE_SCHEMA_VERSION;
export type PublicRecommendationProvider = 'spotify' | 'apple_music' | 'youtube_music' | 'youtube' | 'soundcloud' | 'custom';
export type PublicRecommendationMediaType = 'track' | 'album' | 'artist' | 'playlist' | 'podcast' | 'episode' | 'video' | 'mixed';
export type PublicRecommendationItemMediaType = Exclude<PublicRecommendationMediaType, 'mixed'>;
export type PublicTasteSignalKind = 'genre' | 'artist' | 'track' | 'album' | 'playlist' | 'mood' | 'activity' | 'language' | 'era' | 'tag';

export interface PublicRecommendationArtistInput {
  name: string;
  providerArtistId?: string;
}

export interface PublicRecommendationAlbumInput {
  title?: string;
  providerAlbumId?: string;
}

export interface PublicRecommendationItemInput {
  rank?: number;
  score?: number;
  provider: PublicRecommendationProvider;
  providerItemId: string;
  mediaType: PublicRecommendationItemMediaType;
  title?: string;
  artists?: PublicRecommendationArtistInput[];
  album?: PublicRecommendationAlbumInput;
  imageUrl?: string;
  reason?: string;
  durationMs?: number;
  releaseDate?: string;
  explicit?: boolean;
}

export interface ReplacePublicRecommendationListRequest {
  schemaVersion: PublicAccountSchemaVersion;
  mediaType: PublicRecommendationMediaType;
  locale?: string;
  summary?: string;
  items: PublicRecommendationItemInput[];
  clientContext?: Record<string, unknown>;
}

export interface PublicTasteSignalInput {
  kind: PublicTasteSignalKind;
  key?: string;
  provider?: PublicRecommendationProvider;
  providerItemId?: string;
  label?: string;
  weight: number;
  confidence?: number;
}

export interface ReplacePublicTasteProfileRequest {
  schemaVersion: PublicAccountSchemaVersion;
  summary?: string;
  locale?: string;
  signals: PublicTasteSignalInput[];
  clientContext?: Record<string, unknown>;
}

export interface PublicRecommendationWriteResponse {
  profileId: string;
  listKey: string;
  source: PublicAccountWriteSource;
  version: number;
  itemCount: number;
  created: boolean;
  updatedAt: string;
  etag: string;
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
