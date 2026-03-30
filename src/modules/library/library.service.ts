import { nowIso } from '../../lib/time.js';
import { ProviderImportService } from '../integrations/provider-import.service.js';
import type { ProviderImportConnectionView } from '../integrations/provider-import.views.js';
import type { MetadataCardView } from '../metadata/metadata.types.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchedQueryService } from '../watch/watched.service.js';
import { WatchCollectionService } from '../watch/watch-collection.service.js';
import type {
  LibraryItemView,
  LibrarySectionSource,
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
    const [watched, watchlist, ratings, connections] = await Promise.all([
      this.watchedService.list(userId, profileId, 100),
      this.watchCollectionService.listWatchlist(userId, profileId, 100),
      this.watchCollectionService.listRatings(userId, profileId, 100),
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
        buildSection('watched', 'Watched', 0, watched),
        buildSection('watchlist', 'Watchlist', 1, watchlist),
        buildSection('rated', 'Rated', 2, ratings),
      ],
    };
  }
}

function buildSection(
  id: ProfileLibrarySectionView['id'],
  label: ProfileLibrarySectionView['label'],
  order: number,
  items: LibrarySectionSource[],
): ProfileLibrarySectionView {
  const mappedItems = items.map((item) => mapLibraryItem(item));
  return {
    id,
    label,
    order,
    itemCount: mappedItems.length,
    items: mappedItems,
  };
}

function mapLibraryItem(item: LibrarySectionSource): LibraryItemView {
  const media = item.media;
  return {
    id: media.id,
    media,
    detailsTarget: {
      id: media.id,
      mediaType: media.mediaType,
    },
    playbackTarget: buildPlaybackTarget(media),
    state: {
      addedAt: 'addedAt' in item ? item.addedAt : null,
      watchedAt: 'watchedAt' in item ? item.watchedAt ?? null : null,
      ratedAt: 'rating' in item ? item.rating.ratedAt : null,
      rating: 'rating' in item ? item.rating.value : null,
      lastActivityAt: 'lastActivityAt' in item ? item.lastActivityAt ?? null : null,
    },
    origins: deriveOrigins(item.payload),
  };
}

function buildPlaybackTarget(media: MetadataCardView): LibraryItemView['playbackTarget'] {
  return {
    contentId: media.id,
    mediaType: media.mediaType,
    provider: media.provider ?? null,
    providerId: media.providerId ?? null,
    parentProvider: media.parentProvider ?? null,
    parentProviderId: media.parentProviderId ?? null,
    seasonNumber: media.seasonNumber,
    episodeNumber: media.episodeNumber,
    absoluteEpisodeNumber: media.absoluteEpisodeNumber,
  };
}

function deriveOrigins(payload: Record<string, unknown> | undefined): string[] {
  const provider = typeof payload?.provider === 'string' && payload.provider.trim() ? payload.provider.trim() : null;
  if (provider === 'trakt') {
    return ['trakt_import'];
  }
  if (provider === 'simkl') {
    return ['simkl_import'];
  }
  return ['native'];
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
