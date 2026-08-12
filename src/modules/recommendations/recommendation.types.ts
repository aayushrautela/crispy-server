export type TasteTagConnection = {
  to: string;
  weight: number;
};

export type TasteWeightedEntry = {
  name: string;
  shortScore: number;
  shortCount: number;
  longScore: number;
  longCount: number;
  shortHistogram?: number[];
  longHistogram?: number[];
};

export type TastePersonEntry = TasteWeightedEntry & {
  roles: ('actor' | 'director')[];
};

export type TasteTagVectorEntry = TasteWeightedEntry & {
  connections?: TasteTagConnection[];
};

export type TasteLanguageEntry = {
  code: string;
  shortMovie: number;
  shortShow: number;
  longMovie: number;
  longShow: number;
};

export type TasteVectors = {
  schemaVersion: 3;
  genres: TasteWeightedEntry[];
  tags: TasteTagVectorEntry[];
  people: TastePersonEntry[];
  mood: TasteWeightedEntry[];
  decades: TasteWeightedEntry[];
  ratingTiers: TasteWeightedEntry[];
  languages: TasteLanguageEntry[];
};

export type TasteProfilePayload = {
  profileId: string;
  sourceKey: string;
  contentTypePref: Record<string, unknown>;
  ratingTendency: Record<string, unknown>;
  watchingPace: string | null;
  aiSummary: string | null;
  source: string;
  vectors: TasteVectors;
  version: number;
  createdAt: string;
  updatedAt: string;
};
