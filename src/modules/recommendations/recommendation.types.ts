import type { CollectionCardView, HeroCardView } from '../metadata/metadata-card.types.js';
import type { MediaItem, MediaPresentationHint } from '../metadata/media-item.types.js';

export type TasteProfilePayload = {
  profileId: string;
  sourceKey: string;
  genres: unknown[];
  preferredActors: unknown[];
  preferredDirectors: unknown[];
  contentTypePref: Record<string, unknown>;
  ratingTendency: Record<string, unknown>;
  decadePreferences: unknown[];
  watchingPace: string | null;
  aiSummary: string | null;
  source: string;
  updatedByKind: string;
  updatedById: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type RecommendationItemContext = {
  reason: string | null;
  reasonCodes: string[];
  score: number | null;
  rank: number | null;
  payload: Record<string, unknown>;
};

export type RecommendationSectionItem = {
  kind: 'recommendation';
  mediaItem: MediaItem;
  context: RecommendationItemContext;
  presentation: MediaPresentationHint | null;
  reason: string | null;
  score: number | null;
  rank: number | null;
  payload: Record<string, unknown>;
};

export type RecommendationRegularSection = {
  id: string;
  title: string;
  layout: 'regular';
  items: RecommendationSectionItem[];
  meta: Record<string, unknown>;
};

export type RecommendationLandscapeSection = {
  id: string;
  title: string;
  layout: 'landscape';
  items: RecommendationSectionItem[];
  meta: Record<string, unknown>;
};

export type RecommendationCollectionSection = {
  id: string;
  title: string;
  layout: 'collection';
  items: CollectionCardView[];
  meta: Record<string, unknown>;
};

export type RecommendationHeroSection = {
  id: string;
  title: string;
  layout: 'hero';
  items: HeroCardView[];
  meta: Record<string, unknown>;
};

export type RecommendationSection =
  | RecommendationRegularSection
  | RecommendationLandscapeSection
  | RecommendationCollectionSection
  | RecommendationHeroSection;

export type RecommendationSnapshotPayload = {
  profileId: string;
  sourceKey: string;
  historyGeneration: number;
  algorithmVersion: string;
  sourceCursor: string | null;
  generatedAt: string;
  expiresAt: string | null;
  source: string;
  updatedByKind: string;
  updatedById: string | null;
  sections: RecommendationSection[];
  updatedAt: string;
};
