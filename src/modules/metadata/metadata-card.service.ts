import type { DbClient } from '../../lib/db.js';
import {
  ensureSupportedMediaType,
  inferMediaIdentity,
  parseMediaKey,
  type MediaIdentity,
} from '../identity/media-key.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import type { MetadataCardView } from './metadata-card.types.js';
import { buildMetadataCardView, buildProviderMetadataCardView } from './metadata-card.builders.js';
import type { TmdbEpisodeRecord, TmdbTitleRecord } from './providers/tmdb.types.js';

export class MetadataCardService {
  constructor(
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async buildCardView(client: DbClient, identity: MediaIdentity): Promise<MetadataCardView> {
    const providerContext = await this.providerMetadataService.loadIdentityContext(client, identity);
    if (providerContext?.title) {
      return buildProviderMetadataCardView({
        identity,
        title: providerContext.title,
        currentEpisode: providerContext.currentEpisode,
      });
    }

    const context = await this.loadCardContext(client, identity);
    return buildMetadataCardView({
      identity,
      title: context.title,
      currentEpisode: context.currentEpisode,
    });
  }

  async buildCardViewFromRow(client: DbClient, row: Record<string, unknown>): Promise<MetadataCardView> {
    const identity = this.identityFromRow(row);
    const providerContext = this.normalizeProviderTitleIdentity(identity)
      ? await this.providerMetadataService.loadIdentityContext(client, identity).catch(() => null)
      : null;
    const rowTitle = typeof row.title === 'string' && row.title.trim() ? row.title : null;
    const rowSubtitle = typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle : null;
    const rowPosterUrl = typeof row.poster_url === 'string' && row.poster_url.trim() ? row.poster_url : null;
    const rowBackdropUrl = typeof row.backdrop_url === 'string' && row.backdrop_url.trim() ? row.backdrop_url : null;
    const canUseProjectionOnly = Boolean(
      rowTitle
      && (identity.mediaType !== 'episode' || rowSubtitle)
      && (rowPosterUrl || rowBackdropUrl),
    );

    if (providerContext?.title) {
      return buildProviderMetadataCardView({
        identity,
        title: providerContext.title,
        currentEpisode: providerContext.currentEpisode,
      });
    }

    const context = canUseProjectionOnly
      ? { title: null, currentEpisode: null }
      : await this.loadCardContext(client, identity).catch(() => ({ title: null, currentEpisode: null }));

    return buildMetadataCardView({
      identity,
      title: context.title,
      currentEpisode: context.currentEpisode,
      titleOverride: rowTitle,
      subtitleOverride: identity.mediaType === 'episode'
        ? rowSubtitle ?? buildEpisodeSubtitle(identity.seasonNumber, identity.episodeNumber)
        : rowSubtitle,
      posterUrlOverride: rowPosterUrl,
      backdropUrlOverride: rowBackdropUrl,
    });
  }

  async buildCardViews(client: DbClient, identities: MediaIdentity[]): Promise<MetadataCardView[]> {
    return Promise.all(identities.map((identity) => this.buildCardView(client, identity)));
  }

  private async loadCardContext(client: DbClient, identity: MediaIdentity): Promise<{
    title: TmdbTitleRecord | null;
    currentEpisode: TmdbEpisodeRecord | null;
  }> {
    const titleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
    const titleTmdbId = identity.mediaType === 'episode' ? identity.showTmdbId : identity.tmdbId;
    const title = titleTmdbId ? await this.tmdbCacheService.getTitle(client, titleType, titleTmdbId) : null;

    let currentEpisode: TmdbEpisodeRecord | null = null;
    if (identity.mediaType === 'episode' && identity.showTmdbId && identity.seasonNumber !== null && identity.episodeNumber !== null) {
      currentEpisode = await this.tmdbCacheService.getEpisode(client, identity.showTmdbId, identity.seasonNumber, identity.episodeNumber);
    }

    return { title, currentEpisode };
  }

  private identityFromRow(row: Record<string, unknown>): MediaIdentity {
    const mediaKey = typeof row.media_key === 'string' ? row.media_key : null;
    if (mediaKey) {
      const parsed = parseMediaKey(mediaKey);
      return {
        ...parsed,
        tmdbId: row.tmdb_id === null || row.tmdb_id === undefined ? parsed.tmdbId : Number(row.tmdb_id),
        showTmdbId: row.show_tmdb_id === null || row.show_tmdb_id === undefined ? parsed.showTmdbId : Number(row.show_tmdb_id),
        seasonNumber: row.season_number === null || row.season_number === undefined ? parsed.seasonNumber : Number(row.season_number),
        episodeNumber: row.episode_number === null || row.episode_number === undefined ? parsed.episodeNumber : Number(row.episode_number),
      };
    }

    return inferMediaIdentity({
      mediaKey: String(row.media_key),
      mediaType: ensureSupportedMediaType(String(row.media_type)),
      tmdbId: row.tmdb_id === null || row.tmdb_id === undefined ? null : Number(row.tmdb_id),
      showTmdbId: row.show_tmdb_id === null || row.show_tmdb_id === undefined ? null : Number(row.show_tmdb_id),
      seasonNumber: row.season_number === null || row.season_number === undefined ? null : Number(row.season_number),
      episodeNumber: row.episode_number === null || row.episode_number === undefined ? null : Number(row.episode_number),
    });
  }

  private normalizeProviderTitleIdentity(identity: MediaIdentity): MediaIdentity | null {
    if (identity.mediaType === 'show' || identity.mediaType === 'anime') {
      return identity.provider === 'tvdb' || identity.provider === 'kitsu'
        ? identity
        : null;
    }

    if ((identity.mediaType === 'episode' || identity.mediaType === 'season') && identity.parentProvider && identity.parentProviderId) {
      if (identity.parentProvider !== 'tvdb' && identity.parentProvider !== 'kitsu') {
        return null;
      }

      const mediaType = identity.parentProvider === 'kitsu' ? 'anime' : 'show';
      return inferMediaIdentity({
        mediaType,
        provider: identity.parentProvider,
        providerId: identity.parentProviderId,
        parentContentId: identity.parentContentId ?? null,
      });
    }

    return null;
  }
}

function buildEpisodeSubtitle(seasonNumber: number | null, episodeNumber: number | null): string | null {
  if (seasonNumber === null || episodeNumber === null) {
    return null;
  }

  return `S${String(seasonNumber).padStart(2, '0')} E${String(episodeNumber).padStart(2, '0')}`;
}
