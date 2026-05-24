import type { ClientHomeResponse, ClientHomeSection } from './client-home.types.js';

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

export type RecommendationSection = ClientHomeSection;

export type RecommendationHomePayload = ClientHomeResponse;

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
