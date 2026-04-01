import type { ProviderImportProvider } from '../integrations/provider-import.types.js';
import type { RegularCardView } from '../metadata/metadata.types.js';
import type { RatingStateView } from '../watch/watch-read.types.js';

export type ProviderAuthStateView = {
  provider: ProviderImportProvider;
  connected: boolean;
  status: string;
  externalUsername: string | null;
  statusMessage: string | null;
};

export type LibraryItemView = {
  id: string;
  media: RegularCardView;
  state: {
    addedAt: string | null;
    watchedAt: string | null;
    ratedAt: string | null;
    rating: number | null;
    lastActivityAt: string | null;
  };
  origins: string[];
};

export type ProfileLibrarySectionView = {
  id: 'watched' | 'watchlist' | 'rated';
  label: 'Watched' | 'Watchlist' | 'Rated';
  order: number;
  itemCount: number;
  items: LibraryItemView[];
};

export type ProfileLibraryView = {
  profileId: string;
  source: 'canonical_library';
  generatedAt: string;
  auth: {
    providers: ProviderAuthStateView[];
  };
  sections: ProfileLibrarySectionView[];
};

export type LibraryRatingLike = RatingStateView;
