import type { SupportedProvider } from '../identity/media-key.js';

export type MetadataTitleMediaType = 'movie' | 'show' | 'anime';
export type MetadataViewMediaType = MetadataTitleMediaType | 'episode';
export type MetadataParentMediaType = 'show' | 'anime';

export type MetadataArtwork = {
  posterUrl: string | null;
  backdropUrl: string | null;
  stillUrl: string | null;
};

export type MetadataImages = MetadataArtwork & {
  logoUrl: string | null;
};

export type MetadataExternalIds = {
  tmdb: number | null;
  imdb: string | null;
  tvdb: number | null;
  kitsu: string | null;
};

export type ProviderTitleRecord = {
  mediaType: MetadataTitleMediaType;
  provider: SupportedProvider;
  providerId: string;
  title: string | null;
  originalTitle: string | null;
  summary: string | null;
  overview: string | null;
  releaseDate: string | null;
  status: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  runtimeMinutes: number | null;
  rating: number | null;
  certification: string | null;
  genres: string[];
  externalIds: MetadataExternalIds;
  seasonCount: number | null;
  episodeCount: number | null;
  raw: Record<string, unknown>;
};

export type ProviderEpisodeRecord = {
  mediaType: 'episode';
  provider: SupportedProvider;
  providerId: string;
  parentMediaType: MetadataParentMediaType;
  parentProvider: SupportedProvider;
  parentProviderId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  title: string | null;
  summary: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  rating: number | null;
  stillUrl: string | null;
  raw: Record<string, unknown>;
};

export type ProviderSeasonRecord = {
  provider: SupportedProvider;
  providerId: string;
  parentMediaType: MetadataParentMediaType;
  parentProvider: SupportedProvider;
  parentProviderId: string;
  seasonNumber: number;
  title: string | null;
  summary: string | null;
  airDate: string | null;
  episodeCount: number | null;
  posterUrl: string | null;
  raw: Record<string, unknown>;
};

export type MetadataEpisodePreview = {
  mediaType: 'episode';
  mediaKey: string;
  provider: SupportedProvider;
  providerId: string;
  parentMediaType: MetadataParentMediaType;
  parentProvider: SupportedProvider;
  parentProviderId: string;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number | null;
  title: string | null;
  summary: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  rating: number | null;
  images: MetadataImages;
};

export type MetadataCardView = {
  mediaType: MetadataViewMediaType;
  kind: 'title' | 'episode';
  mediaKey: string;
  provider: SupportedProvider;
  providerId: string;
  parentMediaType: MetadataParentMediaType | null;
  parentProvider: SupportedProvider | null;
  parentProviderId: string | null;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  title: string | null;
  subtitle: string | null;
  summary: string | null;
  overview: string | null;
  artwork: MetadataArtwork;
  images: MetadataImages;
  releaseDate: string | null;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  rating: number | null;
  status: string | null;
};

export type RegularCardView = {
  mediaType: MetadataViewMediaType;
  mediaKey: string;
  provider: SupportedProvider;
  providerId: string;
  title: string;
  posterUrl: string;
  releaseYear: number | null;
  rating: number | null;
  genre: string | null;
  subtitle: string | null;
};

export type CatalogItem = RegularCardView;

export type LandscapeCardView = {
  mediaType: MetadataViewMediaType;
  mediaKey: string;
  provider: SupportedProvider;
  providerId: string;
  title: string;
  posterUrl: string;
  backdropUrl: string;
  releaseYear: number | null;
  rating: number | null;
  genre: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
};

export type CollectionCardItemView = {
  mediaType: MetadataViewMediaType;
  provider: SupportedProvider;
  providerId: string;
  title: string;
  posterUrl: string;
  releaseYear: number | null;
  rating: number | null;
};

export type CollectionCardView = {
  title: string;
  logoUrl: string;
  items: [CollectionCardItemView, CollectionCardItemView, CollectionCardItemView];
};

export type HeroCardView = {
  mediaKey: string;
  mediaType: MetadataViewMediaType;
  provider: SupportedProvider;
  providerId: string;
  title: string;
  description: string;
  backdropUrl: string;
  posterUrl: string | null;
  logoUrl: string | null;
  releaseYear: number | null;
  rating: number | null;
  genre: string | null;
};
