import { nowIso } from '../../lib/time.js';
import { HttpError } from '../../lib/errors.js';
import { ProviderImportService } from '../integrations/provider-import.service.js';
import type { ProviderAccountView } from '../integrations/provider-import.views.js';
import { PersonalMediaService } from '../watch/personal-media.service.js';
import type { PaginatedWatchCollection } from '../watch/watch-read.types.js';
import type { RatingProductItem, WatchedProductItem, WatchlistProductItem } from '../watch/watch-derived-item.types.js';
import type {
  LibraryItemView,
  LibrarySectionSummaryView,
  LibrarySectionView,
  ProfileLibraryDiscoveryView,
  ProfileLibrarySectionPageView,
  ProviderAuthStateView,
} from './library.types.js';

type LibrarySectionPageParams = {
  limit: number;
  cursor?: string | null;
};

type LibrarySectionDefinition = LibrarySectionView & {
  count: (service: PersonalMediaService, userId: string, profileId: string) => Promise<number>;
  listPage: (service: PersonalMediaService, userId: string, profileId: string, params: LibrarySectionPageParams) => Promise<PaginatedWatchCollection<LibraryItemView>>;
};

const LIBRARY_SECTIONS = [
  {
    id: 'watched',
    label: 'Watched',
    order: 0,
    count: (service, userId, profileId) => service.countWatchedProducts(userId, profileId),
    listPage: async (service, userId, profileId, params) => {
      const page = await service.listWatchedPage(userId, profileId, params);
      return { items: page.items.map(mapWatchedLibraryItem), pageInfo: page.pageInfo };
    },
  },
  {
    id: 'watchlist',
    label: 'Watchlist',
    order: 1,
    count: (service, userId, profileId) => service.countWatchlistProducts(userId, profileId),
    listPage: async (service, userId, profileId, params) => {
      const page = await service.listWatchlistPage(userId, profileId, params);
      return { items: page.items.map(mapWatchlistLibraryItem), pageInfo: page.pageInfo };
    },
  },
  {
    id: 'rated',
    label: 'Rated',
    order: 2,
    count: (service, userId, profileId) => service.countRatingsProducts(userId, profileId),
    listPage: async (service, userId, profileId, params) => {
      const page = await service.listRatingsPage(userId, profileId, params);
      return { items: page.items.map(mapRatedLibraryItem), pageInfo: page.pageInfo };
    },
  },
] as const satisfies readonly LibrarySectionDefinition[];

export class LibraryService {
  constructor(
    private readonly personalMediaService = new PersonalMediaService(),
    private readonly providerImportService = new ProviderImportService(),
  ) {}

  async getProfileLibrary(userId: string, profileId: string): Promise<ProfileLibraryDiscoveryView> {
    const [sections, connections] = await Promise.all([
      this.listSectionSummaries(userId, profileId),
      this.providerImportService.listConnections(userId, profileId),
    ]);

    return {
      profileId,
      source: 'canonical_library',
      generatedAt: nowIso(),
      auth: {
        providers: connections.providerAccounts.map(mapProviderAuthState),
      },
      sections,
    };
  }

  async getProfileLibrarySectionPage(
    userId: string,
    profileId: string,
    sectionId: string,
    params: LibrarySectionPageParams,
  ): Promise<ProfileLibrarySectionPageView> {
    const section = getLibrarySection(sectionId);
    const page = await section.listPage(this.personalMediaService, userId, profileId, {
      limit: params.limit,
      cursor: params.cursor,
    });
    return {
      profileId,
      source: 'canonical_library',
      generatedAt: nowIso(),
      section: {
        id: section.id,
        label: section.label,
        order: section.order,
      },
      items: page.items,
      pageInfo: page.pageInfo,
    };
  }

  private async listSectionSummaries(userId: string, profileId: string): Promise<LibrarySectionSummaryView[]> {
    const sections = await Promise.all(LIBRARY_SECTIONS.map(async (section) => ({
      id: section.id,
      label: section.label,
      order: section.order,
      itemCount: await section.count(this.personalMediaService, userId, profileId),
    })));
    return sections.sort((left, right) => left.order - right.order);
  }
}

function getLibrarySection(sectionId: string): LibrarySectionDefinition {
  const section = LIBRARY_SECTIONS.find((entry) => entry.id === sectionId);
  if (!section) {
    throw new HttpError(404, `Unknown library section: ${sectionId}.`);
  }
  return section;
}

function mapWatchedLibraryItem(item: WatchedProductItem): LibraryItemView {
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

function mapWatchlistLibraryItem(item: WatchlistProductItem): LibraryItemView {
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

function mapRatedLibraryItem(item: RatingProductItem): LibraryItemView {
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
