import type { ResponsiveImageSet } from '../metadata/metadata-card.types.js';

export type ClientMediaType = 'movie' | 'tv' | 'season' | 'episode';

export type ClientImages = {
  artwork: ResponsiveImageSet | null;
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
  liked: boolean | null;
  originRating: number | null;
};

export type ClientParentImages = {
  artwork: ResponsiveImageSet | null;
};

export type ClientParentRef = {
  seriesItemId?: string;
  seriesTitle?: string;
  seasonItemId?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  images?: ClientParentImages | null;
};

export type ClientProviderIds = {
  tmdb: string | null;
  tvdb: string | null;
  imdb: string | null;
};

export type ClientMediaCard = {
  itemId: string;
  mediaType: ClientMediaType;
  title: string;
  overview: string | null;
  tagline: string | null;
  year: number | null;
  releaseDate: string | null;
  rating: number | null;
  maturityRating: string | null;
  genres: string[];
  runtimeSeconds: number | null;
  images: ClientImages;
  trailerUrl: string | null;
  progress: ClientProgress | null;
  parent: ClientParentRef | null;
  providerIds: ClientProviderIds | null;
};

export type ClientHomeSectionType = 'categoryTabs' | 'heroCarousel' | 'contentRail' | 'collectionRail';

export type ClientHomeSection = {
  listKey: string;
  title: string;
  subtitle: string | null;
  sectionType: ClientHomeSectionType;
  imageUrl: string | null;
  items: ClientMediaCard[];
  meta: Record<string, unknown>;
};

export type ClientHomeResponse = {
  profileId: string;
  generatedAt: string;
  expiresAt: string | null;
  sections: ClientHomeSection[];
};

/**
 * Backfill for payloads cached before `imageUrl` existed: old sections (and
 * old snapshots) carry no per-section image, which reads as null.
 */
export function normalizeClientHomeSections(sections: ClientHomeSection[]): ClientHomeSection[] {
  for (const section of sections) {
    const imageUrl = (section as { imageUrl?: unknown }).imageUrl;
    section.imageUrl = typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : null;
  }
  return sections;
}

export type ClientMediaCardQueryResult = {
  Items: ClientMediaCard[];
  StartIndex: number;
  TotalRecordCount: number;
  NextCursor: string | null;
  HasMore: boolean;
};
