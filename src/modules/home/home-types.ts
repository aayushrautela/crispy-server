import type { RecommendationWriteActor } from '../recommendations/recommendation-list.types.js';

export type HomeMode = 'custom' | 'recommended';

export type HomeSource = 'custom' | 'reco' | 'fallback';

export type HomeWriteActor = RecommendationWriteActor;

export type HomeSectionType = 'categoryTabs' | 'heroCarousel' | 'contentRail' | 'collectionRail';

export type HomeWriteProviderRef = {
  provider: 'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt';
  providerId: string;
};

export type HomeWriteItem = {
  type: 'movie' | 'tv';
  providerRefs: HomeWriteProviderRef[];
  description?: string;
  metadata?: Record<string, unknown>;
};

export type HomeWriteList = {
  sectionType: HomeSectionType;
  title: string;
  subtitle?: string | null;
  items: HomeWriteItem[];
};

export type HomeWriteInput = {
  accountId: string;
  profileId: string;
  source: string;
  lists: HomeWriteList[];
  idempotencyKey: string;
  actor: HomeWriteActor;
};

export type HomeWriteListResult = {
  listId: string;
  sectionType: HomeSectionType;
  title: string;
  itemCount: number;
  version: number;
};

export type ResolvedHomeRow = {
  listId: string;
  sectionType: HomeSectionType;
  title: string;
  subtitle: string | null;
  version: number;
  sourceRef: { provider: string; providerId: string };
  itemId: string;
  rank: number;
  score: number | null;
};

export type HomeWriteResult = {
  accountId: string;
  profileId: string;
  source: HomeSource;
  status: 'written' | 'cleared' | 'idempotent_replay';
  listsWritten: number;
  itemCount: number;
  lists: HomeWriteListResult[];
  idempotency: { key: string; replayed: boolean };
  createdAt: Date;
};
