export type RecoProvider = 'tmdb' | 'tvdb' | 'imdb' | 'kitsu';
export type RecoMediaType = 'movie' | 'tv';
export type RecoHomeSectionType = 'categoryTabs' | 'heroCarousel' | 'contentRail' | 'collectionRail';

export type RecoProviderRef = {
  provider: RecoProvider;
  providerId: string;
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
