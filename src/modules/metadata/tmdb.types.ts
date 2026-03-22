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

export type MetadataView = {
  mediaKey: string;
  mediaType: string;
  tmdbId: number | null;
  showTmdbId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  title: string | null;
  subtitle: string | null;
  overview: string | null;
  artwork: MetadataArtwork;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  nextEpisode: TmdbEpisodeRecord | null;
};

export type TmdbTitleApiResponse = Record<string, unknown>;
export type TmdbSeasonApiResponse = Record<string, unknown>;
