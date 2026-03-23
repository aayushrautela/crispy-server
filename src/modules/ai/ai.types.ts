export type AiSearchFilter = 'all' | 'movies' | 'series';

export type AiCandidateMediaType = 'movie' | 'tv';

export type AiSearchItem = {
  id: number;
  mediaType: AiCandidateMediaType;
  title: string;
  year: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: string | null;
  overview: string | null;
};

export type AiSearchResponse = {
  items: AiSearchItem[];
};

export type AiInsightCard = {
  category: string;
  title: string;
  content: string;
  type: string;
};

export type AiInsightsPayload = {
  insights: AiInsightCard[];
  trivia: string;
};

export type AiInsightsMediaType = 'movie' | 'tv';
