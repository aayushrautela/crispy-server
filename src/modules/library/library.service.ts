import { nowIso } from '../../lib/time.js';
import { ProviderImportService } from '../integrations/provider-import.service.js';
import type { ProviderImportConnectionView } from '../integrations/provider-import.views.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchedQueryService } from '../watch/watched.service.js';
import { WatchCollectionService } from '../watch/watch-collection.service.js';
import type { WatchDerivedProductItem } from '../watch/watch-derived-item.types.js';
import type {
  LibraryItemView,
  ProfileLibrarySectionView,
  ProfileLibraryView,
  ProviderAuthStateView,
} from './library.types.js';

export class LibraryService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly continueWatchingService = new ContinueWatchingService(),
    private readonly watchedService = new WatchedQueryService(),
    private readonly watchCollectionService = new WatchCollectionService(),
    private readonly providerImportService = new ProviderImportService(),
  ) {}

  async getProfileLibrary(userId: string, profileId: string): Promise<ProfileLibraryView> {
    const [watchedProducts, watchlistProducts, ratingProducts, connections] = await Promise.all([
      this.watchedService.listProducts(userId, profileId, 100),
      this.watchCollectionService.listWatchlistProducts(userId, profileId, 100),
      this.watchCollectionService.listRatingsProducts(userId, profileId, 100),
      this.providerImportService.listConnections(userId, profileId),
    ]);

    return {
      profileId,
      source: 'canonical_library',
      generatedAt: nowIso(),
      auth: {
        providers: connections.connections.map(mapProviderAuthState),
      },
      sections: [
        buildSection('watched', 'Watched', 0, watchedProducts, mapWatchedLibraryItem),
        buildSection('watchlist', 'Watchlist', 1, watchlistProducts, mapWatchlistLibraryItem),
        buildSection('rated', 'Rated', 2, ratingProducts, mapRatedLibraryItem),
      ],
    };
  }
}

function buildSection<T extends WatchDerivedProductItem>(
  id: ProfileLibrarySectionView['id'],
  label: ProfileLibrarySectionView['label'],
  order: number,
  items: T[],
  mapper: (item: T) => LibraryItemView,
): ProfileLibrarySectionView {
  return {
    id,
    label,
    order,
    itemCount: items.length,
    items: items.map(mapper),
  };
}

function mapWatchedLibraryItem(item: WatchDerivedProductItem & { watchedAt: string; origins: string[] }): LibraryItemView {
  return {
    id: item.media.id,
    media: item.media,
    detailsTarget: item.detailsTarget,
    playbackTarget: item.playbackTarget,
    episodeContext: item.episodeContext,
    state: {
      addedAt: null,
      watchedAt: item.watchedAt,
      ratedAt: null,
      rating: null,
      lastActivityAt: item.watchedAt,
    },
    origins: item.origins,
  };
}

function mapWatchlistLibraryItem(item: WatchDerivedProductItem & { addedAt: string; origins: string[] }): LibraryItemView {
  return {
    id: item.media.id,
    media: item.media,
    detailsTarget: item.detailsTarget,
    playbackTarget: item.playbackTarget,
    episodeContext: item.episodeContext,
    state: {
      addedAt: item.addedAt,
      watchedAt: null,
      ratedAt: null,
      rating: null,
      lastActivityAt: item.addedAt,
    },
    origins: item.origins,
  };
}

function mapRatedLibraryItem(item: WatchDerivedProductItem & { rating: { value: number; ratedAt: string }; origins: string[] }): LibraryItemView {
  return {
    id: item.media.id,
    media: item.media,
    detailsTarget: item.detailsTarget,
    playbackTarget: item.playbackTarget,
    episodeContext: item.episodeContext,
    state: {
      addedAt: null,
      watchedAt: null,
      ratedAt: item.rating.ratedAt,
      rating: item.rating.value,
      lastActivityAt: item.rating.ratedAt,
    },
    origins: item.origins,
  };
}

function mapProviderAuthState(connection: ProviderImportConnectionView): ProviderAuthStateView {
  return {
    provider: connection.provider,
    connected: connection.status === 'connected',
    status: connection.status,
    externalUsername: connection.externalUsername,
    statusMessage: buildProviderStatusMessage(connection),
  };
}

function buildProviderStatusMessage(connection: ProviderImportConnectionView): string | null {
  if (connection.status === 'connected') {
    return connection.externalUsername
      ? `Connected as ${connection.externalUsername}`
      : 'Connected';
  }
  if (connection.status === 'expired') {
    return 'Connection expired';
  }
  if (connection.status === 'revoked') {
    return 'Connection revoked';
  }
  if (connection.status === 'pending') {
    return 'Connection pending';
  }
  return null;
}
