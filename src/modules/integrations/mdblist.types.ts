export type MdbListIds = {
  imdb: string | null;
  tmdb: number | null;
  trakt: number | null;
  tvdb: number | null;
  mdblist: string | null;
};

export type MdbListRatings = {
  imdb_rating: number | null;
  imdb_votes: number | null;
  tmdb_rating: number | null;
  tmdb_votes: number | null;
  trakt_rating: number | null;
  trakt_votes: number | null;
  metacritic: number | null;
  metacritic_id: string | null;
  rotten_tomatoes: number | null;
  rotten_tomatoes_id: string | null;
  letterboxd_rating: number | null;
  letterboxd_votes: number | null;
  mdblist_rating: number | null;
  mdblist_votes: number | null;
};

export type MdbListRatingProvider = 'imdb' | 'tmdb';

export type MdbListMediaType = 'movie' | 'show';

export type MdbListReturnRating =
  | 'trakt'
  | 'imdb'
  | 'tmdb'
  | 'letterboxd'
  | 'tomatoes'
  | 'audience'
  | 'metacritic'
  | 'rogerebert'
  | 'mal';

export type MdbListRatingsRequest = {
  provider: MdbListRatingProvider;
  ids: Array<number | string>;
};

export type MdbListRatingsResponse = {
  provider_id: string | null;
  provider_rating: string | null;
  mediatype: string | null;
  ratings: Array<{
    id: number | string;
    rating: number | null;
  }>;
};

export type MdbListTitleResponse = {
  title: string;
  original_title: string | null;
  year: number;
  released: string | null;
  description: string | null;
  runtime: number | null;
  score: number;
  ratings: MdbListRatings;
  ids: MdbListIds;
  poster: string | null;
  backdrop: string | null;
  trailer: string | null;
  certification: string | null;
  language: string | null;
  country: string | null;
  genres: Array<{ name: string }>;
  keywords: Array<{ name: string }>;
  directors: Array<{ name: string; ids: { imdb: string | null; tmdb: number | null } }>;
  writers: Array<{ name: string; ids: { imdb: string | null; tmdb: number | null } }>;
  cast: Array<{ name: string; character: string | null; ids: { imdb: string | null; tmdb: number | null } }>;
  network: string | null;
  studio: string | null;
  status: string | null;
  type: string;
  votes: number | null;
  popularity: number | null;
  trend: number | null;
  budget: number | null;
  revenue: number | null;
  season_count: number | null;
  episode_count: number | null;
  age_rating: string | null;
  us_rating: string | null;
  original_language: string | null;
  updated_at: string;
};

export type MdbListTitleView = {
  ids: {
    imdb: string | null;
    tmdb: number | null;
    trakt: number | null;
    tvdb: number | null;
  };
  title: string | null;
  originalTitle: string | null;
  type: string | null;
  year: number | null;
  description: string | null;
  score: number | null;
  ratings: {
    imdbRating: number | null;
    imdbVotes: number | null;
    tmdbRating: number | null;
    metacritic: number | null;
    rottenTomatoes: number | null;
    letterboxdRating: number | null;
  };
  posterUrl: string | null;
  backdropUrl: string | null;
  genres: string[];
  keywords: string[];
  runtime: number | null;
  certification: string | null;
  released: string | null;
  language: string | null;
  country: string | null;
  seasonCount: number | null;
  episodeCount: number | null;
  directors: string[];
  writers: string[];
  network: string | null;
  studio: string | null;
  status: string | null;
  budget: number | null;
  revenue: number | null;
  updatedAt: string | null;
};

export type MdbListTitleRatingsView = {
  ratings: {
    imdb: number | null;
    tmdb: number | null;
    trakt: number | null;
    metacritic: number | null;
    rottenTomatoes: number | null;
    audience: number | null;
    letterboxd: number | null;
    rogerEbert: number | null;
    myAnimeList: number | null;
  };
};
