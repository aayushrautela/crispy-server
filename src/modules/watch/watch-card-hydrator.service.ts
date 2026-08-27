import type { DbClient } from '../../lib/db.js';
import type { BaseItemDto, UserItemDataDto } from '../metadata/media-item.types.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { toClientMediaCard } from '../metadata/client-media-card.mapper.js';
import { inferMediaIdentity, type MediaIdentity, type SupportedMediaType, type SupportedProvider } from '../identity/media-key.js';
import type { ClientMediaCard, ClientMediaType, ClientProgress, ClientProviderIds } from '../recommendations/client-home.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId } from '../identity/public-item-id.js';
import type { WatchInternalRef } from './watch-read.types.js';

const TICKS_PER_SECOND = 10_000_000;

export class WatchCardHydrator {
  private readonly metadataCardService: MetadataCardService;
  private readonly contentIdentityService: ContentIdentityService;

  constructor(
    metadataCardService: MetadataCardService = new MetadataCardService(),
    contentIdentityService: ContentIdentityService = new ContentIdentityService(),
  ) {
    this.metadataCardService = metadataCardService;
    this.contentIdentityService = contentIdentityService;
  }

  // --- Legacy path (BaseItemDto in, card out) — keep until Phase 3.
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

  /**
   * Phase 1 — Last-layer hydration seam.
   * Input is Brain 1 (itemId + per-user progress only).
   * Enrichment happens here once, via MetadataCardService, before returning to the client.
   */
  async hydrateByIds(client: DbClient, refs: WatchInternalRef[], language?: string | null): Promise<ClientMediaCard[]> {
    if (refs.length === 0) return [];

    const contentIds = refs.map((ref) => assertPublicItemId(ref.itemId));
    const identityByContentId = await this.contentIdentityService.resolveMediaIdentitiesBatched(client, contentIds);

    const ordered: Array<{ ref: WatchInternalRef; identity: MediaIdentity }> = [];
    for (const ref of refs) {
      const identity = identityByContentId.get(assertPublicItemId(ref.itemId));
      if (identity) ordered.push({ ref, identity });
    }
    if (!ordered.length) return [];

    const views = await this.metadataCardService.buildCardViewsForIdentities(
      client,
      ordered.map((entry) => entry.identity),
      language ?? null,
    );

    const cards: ClientMediaCard[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const entry = ordered[i]!;
      const view = views[i];
      if (!view || !view.title) continue;
      cards.push(toClientMediaCard(view, {
        progress: progressFromInternalRef(entry.ref, view),
        itemId: entry.ref.itemId,
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

function progressFromInternalRef(
  ref: import('./watch-read.types.js').WatchInternalRef,
  view: import('../metadata/metadata-card.types.js').MetadataCardView,
): ClientProgress | null {
  const progress = ref.progress;
  if (!progress) return null;
  const positionSeconds = progress.positionSeconds;
  // duration canonical from hydrated view (tmdb runtime), fallback to stored duration.
  const viewDuration = typeof view.runtimeMinutes === 'number' ? view.runtimeMinutes * 60 : null;
  const durationSeconds = viewDuration ?? progress.durationSeconds;
  let percent: number | null = progress.progressBps != null ? progress.progressBps / 100 : null;
  if (percent == null && positionSeconds != null && durationSeconds != null && durationSeconds > 0) {
    percent = (positionSeconds / durationSeconds) * 100;
  }
  return {
    played: progress.played,
    playCount: progress.playCount,
    positionSeconds,
    durationSeconds,
    percent,
    lastPlayedAt: progress.lastPlayedAt,
    watchlisted: progress.isFavorite,
    userRating: progress.rating,
  };
}
