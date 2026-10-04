export type TasteWeightedEntry = {
  name: string;
  shortScore: number;
  shortCount: number;
  longScore: number;
  longCount: number;
  // Per-media-type volume arrived in schema v6. Stored v5 records predate it,
  // so reads tolerate its absence; v6 writes always carry the full shape.
  shortMovie?: number;
  shortShow?: number;
  longMovie?: number;
  longShow?: number;
};

export type TastePersonEntry = TasteWeightedEntry & {
  roles: ('actor' | 'director')[];
  popularity?: number;
};

export type TasteLanguageEntry = {
  code: string;
  shortMovie: number;
  shortShow: number;
  longMovie: number;
  longShow: number;
};

export type TasteVectors = {
  schemaVersion: 5 | 6;
  genres: TasteWeightedEntry[];
  people: TastePersonEntry[];
  decades: TasteWeightedEntry[];
  languages: TasteLanguageEntry[];
  contentMix: { short: { movie: number; show: number }; long: { movie: number; show: number } };
};

export type TastePersona = {
  personaLongTerm?: string | null;
  drivers?: string[];
  personaShortTerm?: string | null;
  personaUpdatedAt?: string | null;
  personaWatchFingerprint?: string | null;
  avoidances?: string[];
};

export type TasteProfileInput = TastePersona & {
  sourceKey: string;
  contentTypePref: Record<string, unknown>;
  watchingPace: string | null;
  aiSummary: string | null;
  source: string;
  vectors: TasteVectors;
};

export type TasteProfilePayload = TasteProfileInput & {
  profileId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
