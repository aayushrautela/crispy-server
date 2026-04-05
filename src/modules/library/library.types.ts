import type { ProviderImportProvider } from '../integrations/provider-import.types.js';
import type { RegularCardView } from '../metadata/metadata-card.types.js';
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

export type LibrarySectionView = {
  id: string;
  label: string;
  order: number;
};

export type LibrarySectionSummaryView = LibrarySectionView & {
  itemCount: number;
};

export type ProfileLibraryDiscoveryView = {
  profileId: string;
  source: 'canonical_library';
  generatedAt: string;
  auth: {
    providers: ProviderAuthStateView[];
  };
  sections: LibrarySectionSummaryView[];
};

export type LibrarySectionPageInfoView = {
  nextCursor: string | null;
  hasMore: boolean;
};

export type ProfileLibrarySectionPageView = {
  profileId: string;
  source: 'canonical_library';
  generatedAt: string;
  section: LibrarySectionView;
  items: LibraryItemView[];
  pageInfo: LibrarySectionPageInfoView;
};

export type LibraryRatingLike = RatingStateView;
