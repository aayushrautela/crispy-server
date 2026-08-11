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
};

export type TastePersonEntry = TasteWeightedEntry & {
  roles: ('actor' | 'director')[];
};

export type TasteTagVectorEntry = TasteWeightedEntry & {
  connections?: TasteTagConnection[];
};

export type TasteVectors = {
  schemaVersion: 1;
  genres: TasteWeightedEntry[];
  tags: TasteTagVectorEntry[];
  people: TastePersonEntry[];
  mood: TasteWeightedEntry[];
  decades: TasteWeightedEntry[];
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
