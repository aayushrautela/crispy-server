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

export type MetadataCardView = {
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
  status: string | null;
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

export type MetadataVideoView = {
  id: string;
  key: string;
  name: string | null;
  site: string | null;
  type: string | null;
  official: boolean;
  publishedAt: string | null;
  url: string | null;
  thumbnailUrl: string | null;
};

export type MetadataPersonRefView = {
  id: string;
  tmdbPersonId: number;
  name: string;
  role: string | null;
  department: string | null;
  profileUrl: string | null;
};

export type MetadataReviewView = {
  id: string;
  author: string | null;
  username: string | null;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
  rating: number | null;
  avatarUrl: string | null;
};

export type MetadataCompanyView = {
  id: number;
  name: string;
  logoUrl: string | null;
  originCountry: string | null;
};

export type MetadataCollectionView = {
  id: number;
  name: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  parts: MetadataCardView[];
};

export type MetadataProductionInfoView = {
  originalLanguage: string | null;
  originCountries: string[];
  spokenLanguages: string[];
  productionCountries: string[];
  companies: MetadataCompanyView[];
  networks: MetadataCompanyView[];
};

export type MetadataTitleDetail = {
  item: MetadataView;
  seasons: MetadataSeasonView[];
  videos: MetadataVideoView[];
  cast: MetadataPersonRefView[];
  directors: MetadataPersonRefView[];
  creators: MetadataPersonRefView[];
  reviews: MetadataReviewView[];
  production: MetadataProductionInfoView;
  collection: MetadataCollectionView | null;
  similar: MetadataCardView[];
};

export type MetadataSeasonDetail = {
  show: MetadataView;
  season: MetadataSeasonView;
  episodes: MetadataEpisodeView[];
};

export type MetadataEpisodeListResponse = {
  show: MetadataView;
  requestedSeasonNumber: number | null;
  effectiveSeasonNumber: number;
  includedSeasonNumbers: number[];
  episodes: MetadataEpisodeView[];
};

export type MetadataNextEpisodeResponse = {
  show: MetadataView;
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  item: MetadataEpisodeView | null;
};

export type OmdbRatingEntry = {
  source: string;
  value: string;
};

export type OmdbContentView = {
  imdbId: string;
  title: string | null;
  type: string | null;
  year: string | null;
  rated: string | null;
  released: string | null;
  runtime: string | null;
  genres: string[];
  directors: string[];
  writers: string[];
  actors: string[];
  plot: string | null;
  languages: string[];
  countries: string[];
  awards: string | null;
  posterUrl: string | null;
  ratings: OmdbRatingEntry[];
  imdbRating: number | null;
  imdbVotes: number | null;
  metascore: number | null;
  boxOffice: string | null;
  production: string | null;
  website: string | null;
  totalSeasons: number | null;
};

export type MetadataTitleContentResponse = {
  item: MetadataView;
  omdb: OmdbContentView;
};

export type PlaybackResolveResponse = {
  item: MetadataView;
  show: MetadataView | null;
  season: MetadataSeasonView | null;
};

export type MetadataPersonKnownForItem = {
  id: string;
  mediaType: 'movie' | 'show';
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  rating: number | null;
  releaseYear: number | null;
};

export type MetadataPersonDetail = {
  id: string;
  tmdbPersonId: number;
  name: string;
  knownForDepartment: string | null;
  biography: string | null;
  birthday: string | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  imdbId: string | null;
  instagramId: string | null;
  twitterId: string | null;
  knownFor: MetadataPersonKnownForItem[];
};

export type MetadataSearchFilter = 'all' | 'movies' | 'series';

export type MetadataSearchResult = MetadataCardView;

export type MetadataSearchResponse = {
  query: string;
  items: MetadataSearchResult[];
};

export type MetadataResolveResponse = {
  item: MetadataView;
};

export type TmdbTitleApiResponse = Record<string, unknown>;
export type TmdbCollectionApiResponse = Record<string, unknown>;
export type TmdbSeasonApiResponse = Record<string, unknown>;
export type TmdbSearchApiResponse = Record<string, unknown>;
export type TmdbSearchResultItem = {
  id?: unknown;
  media_type?: unknown;
};
export type TmdbDiscoverApiResponse = Record<string, unknown>;
export type TmdbPersonApiResponse = Record<string, unknown>;
