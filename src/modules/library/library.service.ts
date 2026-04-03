import { nowIso } from '../../lib/time.js';
import { ProviderImportService } from '../integrations/provider-import.service.js';
import type { ProviderAccountView } from '../integrations/provider-import.views.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { PersonalMediaService } from '../watch/personal-media.service.js';
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
    private readonly personalMediaService = new PersonalMediaService(),
    private readonly providerImportService = new ProviderImportService(),
  ) {}

  async getProfileLibrary(userId: string, profileId: string): Promise<ProfileLibraryView> {
    const [watchedProducts, watchlistProducts, ratingProducts, connections] = await Promise.all([
      this.personalMediaService.listWatchedProducts(userId, profileId, 100),
      this.personalMediaService.listWatchlistProducts(userId, profileId, 100),
      this.personalMediaService.listRatingsProducts(userId, profileId, 100),
      this.providerImportService.listConnections(userId, profileId),
    ]);

    return {
      profileId,
      source: 'canonical_library',
      generatedAt: nowIso(),
      auth: {
        providers: connections.providerAccounts.map(mapProviderAuthState),
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
    id: `${item.media.mediaType}:${item.media.provider}:${item.media.providerId}`,
    media: item.media,
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
    id: `${item.media.mediaType}:${item.media.provider}:${item.media.providerId}`,
    media: item.media,
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
    id: `${item.media.mediaType}:${item.media.provider}:${item.media.providerId}`,
    media: item.media,
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

function mapProviderAuthState(providerAccount: ProviderAccountView): ProviderAuthStateView {
  return {
    provider: providerAccount.provider,
    connected: providerAccount.status === 'connected',
    status: providerAccount.status,
    externalUsername: providerAccount.externalUsername,
    statusMessage: buildProviderStatusMessage(providerAccount),
  };
}

function buildProviderStatusMessage(providerAccount: ProviderAccountView): string | null {
  if (providerAccount.status === 'connected') {
    return providerAccount.externalUsername
      ? `Connected as ${providerAccount.externalUsername}`
      : 'Connected';
  }
  if (providerAccount.status === 'expired') {
    return 'Connection expired';
  }
  if (providerAccount.status === 'revoked') {
    return 'Connection revoked';
  }
  if (providerAccount.status === 'pending') {
    return 'Connection pending';
  }
  return null;
}
