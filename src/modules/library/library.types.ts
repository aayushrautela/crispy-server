import type { HydratedRatingItem, HydratedWatchItem, HydratedWatchlistItem } from '../watch/watch-read.types.js';
import type { MetadataExternalIds, MetadataView } from '../metadata/tmdb.types.js';

export type LibraryProviderSource = 'local' | 'trakt' | 'simkl' | 'all';

export type LibraryMutationSource = 'trakt' | 'simkl' | 'all';

export type ProviderAuthStateView = {
  provider: 'trakt' | 'simkl';
  connected: boolean;
  status: 'connected' | 'disconnected' | 'error';
  tokenState: 'valid' | 'expiring' | 'expired' | 'missing_access_token' | null;
  externalUsername: string | null;
  lastImportCompletedAt: string | null;
  lastUsedAt: string | null;
  message: string | null;
};

export type NativeLibraryView = {
  continueWatching: HydratedWatchItem[];
  history: HydratedWatchItem[];
  watchlist: HydratedWatchlistItem[];
  ratings: HydratedRatingItem[];
};

export type CanonicalLibraryItemView = {
  key: string;
  mediaKey: string | null;
  contentId: string;
  contentType: 'movie' | 'show';
  externalIds: MetadataExternalIds | null;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  addedAt: string;
  providers: Array<'trakt' | 'simkl'>;
  folderIds: string[];
  media: MetadataView | null;
};

export type CanonicalLibraryView = NativeLibraryView & {
  source: 'canonical_library';
  generatedAt: string;
  items: CanonicalLibraryItemView[];
};

export type ProviderLibraryFolderView = {
  id: string;
  label: string;
  provider: 'trakt' | 'simkl';
  itemCount: number;
};

export type ProviderLibraryItemView = {
  provider: 'trakt' | 'simkl';
  folderId: string;
  contentId: string;
  contentType: 'movie' | 'show';
  externalIds: MetadataExternalIds | null;
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  addedAt: string;
  media: MetadataView | null;
};

export type ProviderLibrarySnapshotView = {
  provider: 'trakt' | 'simkl';
  status: 'connected' | 'disconnected' | 'error';
  statusMessage: string;
  folders: ProviderLibraryFolderView[];
  items: ProviderLibraryItemView[];
};

export type LibraryDiagnosticsView = {
  source: 'provider_diagnostics';
  generatedAt: string;
  providers: ProviderLibrarySnapshotView[];
};

export type ProfileLibraryResponse = {
  profileId: string;
  source: LibraryProviderSource;
  generatedAt: string;
  auth: {
    providers: ProviderAuthStateView[];
  };
  canonical: CanonicalLibraryView;
  native: NativeLibraryView | null;
  diagnostics: LibraryDiagnosticsView;
};

export type ProviderMutationResultView = {
  provider: 'trakt' | 'simkl';
  status: 'success' | 'skipped' | 'error';
  message: string | null;
};

export type LibraryMutationResponse = {
  source: LibraryMutationSource;
  action: 'watchlist' | 'rating';
  media: MetadataView;
  watchlist: boolean | null;
  rating: number | null;
  results: ProviderMutationResultView[];
  statusMessage: string;
};
