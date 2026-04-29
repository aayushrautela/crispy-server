import type { MediaRef, MetadataHint, ProviderIds } from '../media-ref.types.js';

export interface IntegrationRecommendationItemInput {
  mediaRef: MediaRef;
  metadataHint?: MetadataHint;
  score?: number | null;
  reason?: string | null;
  reasonCode?: string | null;
}

export interface IntegrationRecommendationListWriteInput {
  title?: string | null;
  description?: string | null;
  algorithmKey?: string | null;
  modelVersion?: string | null;
  generatedAt?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
  items: IntegrationRecommendationItemInput[];
}

export interface ValidatedRecommendationItemInput {
  position: number;
  mediaRef: MediaRef;
  metadataHint: MetadataHint | null;
  score: number | null;
  reason: string | null;
  reasonCode: string | null;
}

export interface ValidatedRecommendationListWriteInput {
  title: string | null;
  description: string | null;
  algorithmKey: string | null;
  modelVersion: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  items: ValidatedRecommendationItemInput[];
}

export interface RecommendationListRecord {
  id: string;
  accountId: string;
  profileId: string;
  sourceId: string;
  sourceKey: string;
  listKey: string;
  title: string | null;
  description: string | null;
  algorithmKey: string | null;
  modelVersion: string | null;
  etag: string;
  itemCount: number;
  status: 'active' | 'deleted';
  generatedAt: string | null;
  expiresAt: string | null;
  replacedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface RecommendationListItemRecord {
  id: string;
  listId: string;
  accountId: string;
  profileId: string;
  sourceId: string;
  listKey: string;
  position: number;
  mediaType: MediaRef['mediaType'];
  canonicalId: string | null;
  providerIds: ProviderIds;
  seriesRef: MediaRef['series'] | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  seasonProviderIds: ProviderIds | null;
  episodeProviderIds: ProviderIds | null;
  metadataHint: MetadataHint | null;
  rawMediaRef: MediaRef;
  score: number | null;
  reason: string | null;
  reasonCode: string | null;
  generatedAt: string | null;
  resolutionStatus: 'unresolved' | 'resolved' | 'failed' | 'not_attempted';
  resolvedContentId: string | null;
  resolvedMediaKey: string | null;
  resolvedAt: string | null;
  resolutionError: string | null;
  createdAt: string;
}

export interface RecommendationListWithItems {
  list: RecommendationListRecord;
  items: RecommendationListItemRecord[];
}

export interface RecommendationWriteRequestRecord {
  id: string;
  accountId: string;
  profileId: string;
  sourceId: string;
  listKey: string;
  idempotencyKey: string;
  requestHash: string;
  responseEtag: string;
  status: 'succeeded' | 'failed';
  createdAt: string;
}
