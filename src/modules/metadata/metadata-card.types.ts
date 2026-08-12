export type MetadataTitleMediaType = 'movie' | 'show';
export type MetadataViewMediaType = MetadataTitleMediaType | 'episode';
export type MetadataParentMediaType = 'show';

export type ResponsiveImageSet = {
  small: string | null;
  medium: string | null;
  large: string | null;
};

export type MetadataArtwork = {
  poster: ResponsiveImageSet;
  backdrop: ResponsiveImageSet;
  still: ResponsiveImageSet;
};

export type MetadataImages = MetadataArtwork & {
  logo: ResponsiveImageSet;
};

export type MetadataExternalIds = {
  tmdb: number | null;
  imdb: string | null;
  tvdb: number | null;
};

export type MetadataEpisodePreview = {
  mediaType: 'episode';
  itemId: string;
  parentMediaType: MetadataParentMediaType;
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
  itemId: string;
  parentMediaType: MetadataParentMediaType | null;
  seriesItemId: string | null;
  seasonItemId: string | null;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
  title: string | null;
  subtitle: string | null;
  summary: string | null;
  overview: string | null;
  tagline: string | null;
  artwork: MetadataArtwork;
  images: MetadataImages;
  releaseDate: string | null;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  rating: number | null;
  status: string | null;
  maturityRating: string | null;
  trailerUrl: string | null;
  trailerThumbnailUrl: string | null;
  posterColor: string | null;
  backdropColor: string | null;
  genres: string[];
};

export type RegularCardView = {
  mediaType: MetadataViewMediaType;
  itemId: string;
  title: string;
  poster: ResponsiveImageSet;
  releaseYear: number | null;
  rating: number | null;
  genre: string | null;
  subtitle: string | null;
};

export type CatalogItem = RegularCardView;

export type LandscapeCardView = {
  mediaType: MetadataViewMediaType;
  itemId: string;
  title: string;
  poster: ResponsiveImageSet;
  backdrop: ResponsiveImageSet;
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
  title: string;
  poster: ResponsiveImageSet;
  releaseYear: number | null;
  rating: number | null;
};

export type CollectionCardView = {
  title: string;
  logo: ResponsiveImageSet;
  items: [CollectionCardItemView, CollectionCardItemView, CollectionCardItemView];
};

export type HeroCardView = {
  itemId: string;
  mediaType: MetadataViewMediaType;
  title: string;
  description: string;
  backdrop: ResponsiveImageSet;
  poster: ResponsiveImageSet;
  logo: ResponsiveImageSet;
  releaseYear: number | null;
  rating: number | null;
  genre: string | null;
};
