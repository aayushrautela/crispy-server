export type RecoProvider = 'tmdb' | 'tvdb' | 'imdb' | 'kitsu';
export type RecoMediaType = 'movie' | 'tv';
export type RecoHomeSectionType = 'categoryTabs' | 'heroCarousel' | 'contentRail' | 'collectionRail';

export type RecoProviderRef = {
  provider: RecoProvider;
  providerId: string;
};

export type RecoItemRef = {
  type: RecoMediaType;
  providerRefs: RecoProviderRef[];
};

export type RecoHistorySignal = {
  item: RecoItemRef;
  watchedAt: Date;
  progressPercent: number;
  completionState: 'completed' | 'partial' | 'unknown';
  durationSeconds: number | null;
};

export type RecoRatingSignal = {
  item: RecoItemRef;
  rating: number;
  ratedAt: Date;
  ratingSource: string | null;
};

export type RecoWatchlistSignal = {
  item: RecoItemRef;
  addedAt: Date;
};

export type RecoContinueSignal = {
  item: RecoItemRef;
  progressPercent: number;
  updatedAt: Date;
};

export type RecoNegativeSignal = {
  item: RecoItemRef;
  reason: string;
  createdAt: Date;
};

export type RecoImpressionSignal = {
  item: RecoItemRef;
  listKey: string;
  shownAt: Date;
};

export type RecoWriteItem = {
  type: RecoMediaType;
  providerRefs: RecoProviderRef[];
  score: number | null;
  reason: string | null;
  reasonCodes: string[];
  metadata: Record<string, unknown>;
};

export type RecoModelInfo = {
  runId: string | null;
  algorithmVersion: string;
  modelVersion: string | null;
};
