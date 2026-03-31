import type { ProviderImportProvider } from '../integrations/provider-import.types.js';
import type { MetadataCardView } from '../metadata/metadata.types.js';
import type { RatingStateView } from '../watch/watch-read.types.js';
import type { DetailsTarget, EpisodeContext, PlaybackTarget } from '../watch/watch-derived-item.types.js';

export type ProviderAuthStateView = {
  provider: ProviderImportProvider;
  connected: boolean;
  status: string;
  externalUsername: string | null;
  statusMessage: string | null;
};

export type {
  DetailsTarget,
  PlaybackTarget,
  EpisodeContext,
} from '../watch/watch-derived-item.types.js';

export type LibraryItemView = {
  id: string;
  media: MetadataCardView;
  detailsTarget: DetailsTarget;
  playbackTarget: PlaybackTarget | null;
  episodeContext: EpisodeContext;
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
