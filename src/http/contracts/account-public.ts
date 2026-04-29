export type PublicMediaType = 'movie' | 'show' | 'season' | 'episode' | 'unknown';

export interface PublicAccountDto {
  id: string;
  email: string | null;
  createdAt: string;
  profiles: PublicProfileSummaryDto[];
}

export interface PublicProfileSummaryDto {
  id: string;
  name: string;
  avatarUrl: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfileDto extends PublicProfileSummaryDto {
  profileGroupId: string;
}

export interface PublicMediaItemDto {
  mediaKey: string;
  mediaType: PublicMediaType;
  title: string;
  subtitle: string | null;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  runtimeMinutes: number | null;
  rating: number | null;
}

export interface PublicWatchItemDto {
  id: string;
  profileId: string;
  media: PublicMediaItemDto;
  watchedAt: string;
}

export interface PublicWatchlistItemDto {
  id: string;
  profileId: string;
  media: PublicMediaItemDto;
  addedAt: string;
}

export interface PublicRatingDto {
  id: string;
  profileId: string;
  media: PublicMediaItemDto;
  rating: number;
  ratedAt: string;
}

export interface PublicContinueWatchingItemDto {
  id: string;
  profileId: string;
  media: PublicMediaItemDto;
  lastActivityAt: string;
  progressSeconds: number | null;
  durationSeconds: number | null;
  progressPercent: number;
}

export interface PublicRecommendationDto {
  id: string;
  profileId: string;
  title: string | null;
  generatedAt: string;
  items: PublicRecommendationItemDto[];
}

export interface PublicRecommendationItemDto {
  rank: number;
  media: PublicMediaItemDto;
  reason: string | null;
}

export interface PublicLanguageProfileDto {
  profileId: string;
  status: 'pending' | 'ready' | 'empty';
  sampleSize: number;
  windowSize: number;
  computedAt: string | null;
  ratios: Array<{ language: string; ratio: number; count: number }>;
  primaryLanguage: string | null;
}

export interface PublicTasteDto {
  id: string;
  profileId: string;
  computedAt: string;
  summary: string | null;
  genres: Array<{ name: string; weight: number }>;
}

export interface PublicPageDto<T> {
  items: T[];
  page: { limit: number; nextCursor: string | null };
}
