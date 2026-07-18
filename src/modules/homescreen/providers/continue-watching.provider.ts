import { withDbClient, type DbClient } from '../../../lib/db.js';
import { LocalUserWatchService } from '../../integrations/local-user-watch.service.js';
import { WatchMetadataEnrichmentService } from '../../watch/watch-metadata-enrichment.service.js';
import type { BaseItemDto } from '../../metadata/media-item.types.js';
import type { ClientHomeSection, ClientMediaCard, ClientMediaType } from '../../recommendations/client-home.types.js';
import type { SectionProviderContext } from '../homescreen.types.ts';

const CONTINUE_WATCHING_LIMIT = 20;
const TICKS_PER_SECOND = 10_000_000;

/**
 * Continue-watching rail. Unlike the shared TMDB rails, this is per-profile and
 * is layered onto the cached default home at request time. Returns an empty
 * section (filtered out by the builder) when the profile has no progress.
 */
export class ContinueWatchingProvider {
  constructor(
    private readonly watchService = new LocalUserWatchService(),
    private readonly enrichmentService = new WatchMetadataEnrichmentService(),
  ) {}

  async layer(
    sections: ClientHomeSection[],
    profileId: string,
    locale: string,
    _region: string | null,
  ): Promise<ClientHomeSection[]> {
    const page = await this.watchService.listContinueWatchingPage({
      accountId: '',
      profileId,
      limit: CONTINUE_WATCHING_LIMIT,
      cursor: null,
    });
    if (page.items.length === 0) {
      return sections;
    }

    const enriched: BaseItemDto[] = await withDbClient((client: DbClient) =>
      this.enrichmentService.enrichContinueWatchingItems(client, page.items, locale),
    );

    const cards = enriched.map((item) => mapContinueWatchingItem(item)).filter((card): card is ClientMediaCard => card !== null);
    if (cards.length === 0) {
      return sections;
    }

    const rail: ClientHomeSection = {
      listKey: 'continue-watching',
      title: 'Continue Watching',
      subtitle: null,
      sectionType: 'contentRail',
      items: cards,
      meta: {},
    };
    return [rail, ...sections];
  }
}

function mapContinueWatchingItem(item: BaseItemDto): ClientMediaCard | null {
  if (!item.Name) {
    return null;
  }
  const mediaType: ClientMediaType = item.Type === 'Movie' ? 'movie' : item.Type === 'Episode' ? 'episode' : 'tv';
  const userData = item.UserData;
  const positionSeconds = userData?.PlaybackPositionTicks != null
    ? Math.round(userData.PlaybackPositionTicks / TICKS_PER_SECOND)
    : null;
  const durationSeconds = userData?.RuntimeTicks != null
    ? Math.round(userData.RuntimeTicks / TICKS_PER_SECOND)
    : null;
  const percent = userData?.PlayedPercentage != null
    ? userData.PlayedPercentage
    : positionSeconds != null && durationSeconds != null && durationSeconds > 0
      ? Math.min(100, Math.round((positionSeconds / durationSeconds) * 100))
      : null;

  return {
    itemId: item.Id,
    mediaType,
    title: item.Name,
    subtitle: item.SeriesName ?? null,
    overview: item.Overview ?? null,
    year: item.ProductionYear,
    releaseDate: item.PremiereDate ?? null,
    rating: item.CommunityRating,
    maturityRating: item.OfficialRating ?? null,
    genres: item.Genres ?? [],
    runtimeSeconds: durationSeconds,
    images: {
      poster: item.ImageTags.Primary,
      backdrop: item.ImageTags.Backdrop?.[0] ?? null,
      logo: item.ImageTags.Logo ?? null,
      still: null,
    },
    progress: {
      played: userData?.Played ?? false,
      playCount: userData?.PlayCount ?? 0,
      positionSeconds,
      durationSeconds,
      percent,
      lastPlayedAt: userData?.LastPlayedDate ?? null,
      watchlisted: false,
      userRating: userData?.Rating ?? null,
    },
    parent: item.SeriesId
      ? { seriesItemId: item.SeriesId ?? undefined, seriesTitle: item.SeriesName ?? undefined, seasonItemId: item.SeasonId ?? undefined, seasonNumber: item.ParentIndexNumber ?? null, episodeNumber: item.IndexNumber ?? null }
      : null,
  };
}
