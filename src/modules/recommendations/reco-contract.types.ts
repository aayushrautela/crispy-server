export type RecoProvider = 'tmdb' | 'tvdb' | 'imdb' | 'kitsu';
export type RecoMediaType = 'movie' | 'tv' | 'season' | 'episode';
export type RecoLayout = 'regular' | 'landscape' | 'hero' | 'collection';

export type RecoProviderRef = {
  provider: RecoProvider;
  providerId: string;
};

export type RecoItemFeatures = {
  title: string;
  originalTitle: string | null;
  year: number | null;
  releaseDate: string | null;
  genres: string[];
  runtimeSeconds: number | null;
  maturityRating: string | null;
  language: string | null;
  country: string | null;
  popularity: number | null;
};

export type RecoItemRef = {
  itemId: string;
  type: RecoMediaType;
  providerRefs: RecoProviderRef[];
  features: RecoItemFeatures;
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

export type RecoWriteItemIdentity =
  | { itemId: string }
  | { ref: RecoProviderRef & { type: RecoMediaType } };

export type RecoWriteItem = {
  item: RecoWriteItemIdentity;
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
