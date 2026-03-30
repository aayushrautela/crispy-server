import type { HydratedWatchItem, HydratedWatchlistItem } from '../watch/watch-read.types.js';

export type ProfileLibraryView = {
  profileId: string;
  generatedAt: string;
  watched: HydratedWatchItem[];
  watchlist: HydratedWatchlistItem[];
};
