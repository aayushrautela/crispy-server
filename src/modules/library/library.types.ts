import type { ProviderImportProvider } from '../integrations/provider-import.types.js';
import type { MetadataCardView, MetadataViewMediaType } from '../metadata/metadata.types.js';
import type {
  HydratedRatingItem,
  HydratedWatchItem,
  HydratedWatchlistItem,
  RatingStateView,
} from '../watch/watch-read.types.js';

export type ProviderAuthStateView = {
  provider: ProviderImportProvider;
  connected: boolean;
  status: string;
  externalUsername: string | null;
  statusMessage: string | null;
};

export type LibraryDetailsTarget = {
  id: string;
  mediaType: MetadataViewMediaType;
};

export type LibraryPlaybackTarget = {
  contentId: string | null;
  mediaType: MetadataViewMediaType;
  provider: string | null;
  providerId: string | null;
  parentProvider: string | null;
  parentProviderId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteEpisodeNumber: number | null;
};

export type LibraryItemView = {
  id: string;
  media: MetadataCardView;
  detailsTarget: LibraryDetailsTarget;
  playbackTarget: LibraryPlaybackTarget | null;
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

export type LibrarySectionSource = HydratedWatchItem | HydratedWatchlistItem | HydratedRatingItem;

export type LibraryRatingLike = RatingStateView;
