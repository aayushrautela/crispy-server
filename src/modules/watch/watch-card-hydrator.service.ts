import type { DbClient } from '../../lib/db.js';
import type { BaseItemDto, UserItemDataDto } from '../metadata/media-item.types.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { toClientMediaCard } from '../metadata/client-media-card.mapper.js';
import { inferMediaIdentity, type MediaIdentity, type SupportedMediaType, type SupportedProvider } from '../identity/media-key.js';
import type { ClientMediaCard, ClientMediaType, ClientProgress, ClientProviderIds } from '../recommendations/client-home.types.js';

const TICKS_PER_SECOND = 10_000_000;

export class WatchCardHydrator {
  private readonly metadataCardService: MetadataCardService;

  constructor(metadataCardService: MetadataCardService = new MetadataCardService()) {
    this.metadataCardService = metadataCardService;
  }

  async hydrateItems(client: DbClient, items: BaseItemDto[], language?: string | null, extended = true): Promise<ClientMediaCard[]> {
    if (items.length === 0) return [];

    const resolved = items
      .map((item) => ({ item, identity: identityFromBaseItemDto(item) }))
      .filter((entry): entry is { item: BaseItemDto; identity: MediaIdentity } => entry.identity !== null);
    if (resolved.length === 0) return [];

    if (!extended) {
      return resolved.map(({ item, identity }) => this.toLightweightCard(item, identity));
    }

    const views = await this.metadataCardService.buildCardViews(client, resolved.map((entry) => entry.identity), language ?? null);

    const cards: ClientMediaCard[] = [];
    for (let index = 0; index < resolved.length; index += 1) {
      const entry = resolved[index];
      const view = views[index];
      if (!entry || !view) continue;
      cards.push(toClientMediaCard(view, {
        progress: progressFromUserData(entry.item.UserData),
        itemId: entry.item.Id,
        seriesTitle: entry.item.SeriesName ?? undefined,
      }));
    }
    return cards;
  }

  private toLightweightCard(item: BaseItemDto, identity: MediaIdentity): ClientMediaCard {
    return {
      itemId: item.Id,
      mediaType: toClientMediaType(identity.mediaType),
      title: item.Name,
      overview: null,
      year: null,
      releaseDate: null,
      rating: null,
      maturityRating: null,
      genres: [],
      runtimeSeconds: null,
      images: { poster: null, backdrop: null, logo: null, still: null },
      trailerUrl: null,
      progress: progressFromUserData(item.UserData),
      parent: null,
      providerIds: providerIdsFromBaseItem(item.ProviderIds),
    };
  }
}

function identityFromBaseItemDto(item: BaseItemDto): MediaIdentity | null {
  const mediaType = mediaTypeFromBaseItemKind(item.Type);
  if (!mediaType) return null;

  const providerTmdb = item.ProviderIds?.Tmdb ?? null;
  const providerTvdb = item.ProviderIds?.Tvdb ?? null;
  const providerImdb = item.ProviderIds?.Imdb ?? null;

  if (mediaType === 'episode' || mediaType === 'season') {
    const showTmdb = providerTmdb ? Number(providerTmdb) : null;
    if (!showTmdb || !Number.isFinite(showTmdb)) return null;
    const seasonNumber = item.ParentIndexNumber;
    const episodeNumber = mediaType === 'episode' ? item.IndexNumber : null;
    if (seasonNumber === null) return null;
    if (mediaType === 'episode' && episodeNumber === null) return null;

    return inferMediaIdentity({
      mediaType,
      provider: 'tmdb',
      providerId: providerTmdb ?? undefined,
      showTmdbId: showTmdb,
      seasonNumber,
      episodeNumber,
    });
  }

  if (mediaType === 'movie' || mediaType === 'show') {
    const providerId = providerTmdb ?? providerTvdb ?? providerImdb;
    if (!providerId) return null;
    const provider: SupportedProvider = providerTmdb ? 'tmdb' : providerTvdb ? 'tvdb' : 'imdb';

    return inferMediaIdentity({
      mediaType,
      provider,
      providerId,
      tmdbId: providerTmdb ? Number(providerTmdb) : null,
    });
  }

  return null;
}

function mediaTypeFromBaseItemKind(kind: BaseItemDto['Type']): SupportedMediaType | null {
  if (kind === 'Movie') return 'movie';
  if (kind === 'Series') return 'show';
  if (kind === 'Season') return 'season';
  if (kind === 'Episode') return 'episode';
  return null;
}

function toClientMediaType(mediaType: string): ClientMediaType {
  if (mediaType === 'show') return 'tv';
  if (mediaType === 'movie' || mediaType === 'season' || mediaType === 'episode') return mediaType;
  return 'movie';
}

function progressFromUserData(userData: UserItemDataDto | null): ClientProgress | null {
  if (!userData) return null;

  const positionSeconds = ticksToSeconds(userData.PlaybackPositionTicks);
  const durationSeconds = ticksToSeconds(userData.RuntimeTicks);

  return {
    played: userData.Played,
    playCount: userData.PlayCount,
    positionSeconds,
    durationSeconds,
    percent: userData.PlayedPercentage,
    lastPlayedAt: userData.LastPlayedDate,
    watchlisted: userData.IsFavorite,
    userRating: userData.Rating,
  };
}

function ticksToSeconds(ticks: number | null): number | null {
  if (ticks === null || !Number.isFinite(ticks)) return null;
  return ticks / TICKS_PER_SECOND;
}

function providerIdsFromBaseItem(providerIds: BaseItemDto['ProviderIds']): ClientProviderIds | null {
  if (!providerIds) return null;
  const tmdb = providerIds.Tmdb ?? null;
  const tvdb = providerIds.Tvdb ?? null;
  const imdb = providerIds.Imdb ?? null;
  if (!tmdb && !tvdb && !imdb) return null;
  return { tmdb: tmdb ?? null, tvdb: tvdb ?? null, imdb: imdb ?? null };
}
