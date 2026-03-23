import type { MetadataView } from '../metadata/tmdb.types.js';

export type TasteProfilePayload = {
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

export type RecommendationSectionItem = {
  media: MetadataView;
  reason: string | null;
  score: number | null;
  rank: number | null;
  payload: Record<string, unknown>;
};

export type RecommendationSection = {
  id: string;
  title: string;
  items: RecommendationSectionItem[];
  meta: Record<string, unknown>;
};

export type RecommendationSnapshotPayload = {
  profileId: string;
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
