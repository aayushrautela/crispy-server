import type { ResponsiveImageSet } from '../metadata/metadata-card.types.js';

export type ClientMediaType = 'movie' | 'tv' | 'season' | 'episode';

export type ClientImages = {
  poster: ResponsiveImageSet | null;
  backdrop: ResponsiveImageSet | null;
  logo: ResponsiveImageSet | null;
  still?: ResponsiveImageSet | null;
};

export type ClientProgress = {
  played: boolean;
  playCount: number;
  positionSeconds: number | null;
  durationSeconds: number | null;
  percent: number | null;
  lastPlayedAt: string | null;
  watchlisted: boolean;
  userRating: number | null;
};

export type ClientParentRef = {
  seriesItemId?: string;
  seriesTitle?: string;
  seasonItemId?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export type ClientMediaCard = {
  itemId: string;
  mediaType: ClientMediaType;
  title: string;
  subtitle: string | null;
  overview: string | null;
  year: number | null;
  releaseDate: string | null;
  rating: number | null;
  maturityRating: string | null;
  genres: string[];
  runtimeSeconds: number | null;
  images: ClientImages;
  progress: ClientProgress | null;
  parent: ClientParentRef | null;
};

export type ClientHomeLayout = 'regular' | 'landscape' | 'hero' | 'collection';

export type ClientHomeSection = {
  listKey: string;
  title: string;
  subtitle: string | null;
  layout: ClientHomeLayout;
  items: ClientMediaCard[];
  meta: Record<string, unknown>;
};

export type ClientHomeResponse = {
  profileId: string;
  generatedAt: string;
  expiresAt: string | null;
  sections: ClientHomeSection[];
};
