export type TmdbTitleType = 'movie' | 'tv';

export type TmdbTitleRecord = {
  mediaType: TmdbTitleType;
  tmdbId: number;
  name: string | null;
  originalName: string | null;
  overview: string | null;
  releaseDate: string | null;
  firstAirDate: string | null;
  status: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  runtime: number | null;
  episodeRunTime: number[];
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  externalIds: Record<string, unknown>;
  raw: Record<string, unknown>;
  fetchedAt: string;
  expiresAt: string;
};

export type TmdbEpisodeRecord = {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  tmdbId: number | null;
  name: string | null;
  overview: string | null;
  airDate: string | null;
  runtime: number | null;
  stillPath: string | null;
  voteAverage: number | null;
  raw: Record<string, unknown>;
  fetchedAt: string;
  expiresAt: string;
};

export type TmdbSeasonRecord = {
  showTmdbId: number;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  airDate: string | null;
  posterPath: string | null;
  episodeCount: number | null;
  raw: Record<string, unknown>;
  fetchedAt: string;
  expiresAt: string;
};

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
};

export type MetadataEpisodePreview = {
  id: string;
  mediaType: 'episode';
  tmdbId: number | null;
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  summary: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  rating: number | null;
  images: MetadataImages;
};

export type MetadataView = {
  id: string;
  mediaKey: string;
  mediaType: 'movie' | 'show' | 'episode';
  kind: 'title' | 'episode';
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
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
  certification: string | null;
  status: string | null;
  genres: string[];
  externalIds: MetadataExternalIds;
  seasonCount: number | null;
  episodeCount: number | null;
  nextEpisode: MetadataEpisodePreview | null;
};

export type MetadataSeasonView = {
  id: string;
  showId: string;
  showTmdbId: number;
  seasonNumber: number;
  title: string | null;
  summary: string | null;
  airDate: string | null;
  episodeCount: number | null;
  images: {
    posterUrl: string | null;
  };
};

export type MetadataEpisodeView = MetadataEpisodePreview & {
  showId: string;
  showTitle: string | null;
  showExternalIds: MetadataExternalIds;
};

export type MetadataTitleDetail = {
  item: MetadataView;
  seasons: MetadataSeasonView[];
};

export type MetadataSeasonDetail = {
  show: MetadataView;
  season: MetadataSeasonView;
  episodes: MetadataEpisodeView[];
};

export type MetadataSearchResult = MetadataView;

export type MetadataSearchResponse = {
  query: string;
  items: MetadataSearchResult[];
};

export type MetadataResolveResponse = {
  item: MetadataView;
};

export type TmdbTitleApiResponse = Record<string, unknown>;
export type TmdbSeasonApiResponse = Record<string, unknown>;
export type TmdbSearchApiResponse = Record<string, unknown>;
