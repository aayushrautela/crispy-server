import type { DbClient } from '../../lib/db.js';
import {
  ensureSupportedMediaType,
  inferMediaIdentity,
  parseMediaKey,
  type MediaIdentity,
} from '../identity/media-key.js';
import type { MetadataCardView } from './metadata-card.types.js';
import { buildMetadataCardView, buildProviderMetadataCardView } from './metadata-card.builders.js';
import { MetadataTitleSourceService } from './metadata-title-source.service.js';

export class MetadataCardService {
  constructor(
    private readonly titleSourceService = new MetadataTitleSourceService(),
  ) {}

  async buildCardView(client: DbClient, identity: MediaIdentity): Promise<MetadataCardView> {
    const source = await this.titleSourceService.loadTitleSource(client, identity);
    if (source.providerContext?.title) {
      return buildProviderMetadataCardView({
        identity: source.providerIdentity ?? identity,
        title: source.providerContext.title,
        currentEpisode: source.providerContext.currentEpisode,
      });
    }

    return buildMetadataCardView({
      identity,
      title: source.tmdbTitle,
      currentEpisode: source.tmdbCurrentEpisode,
    });
  }

  async buildCardViewFromRow(client: DbClient, row: Record<string, unknown>): Promise<MetadataCardView> {
    const identity = this.identityFromRow(row);
    const source = await this.titleSourceService.loadTitleSource(client, identity).catch(() => null);
    const rowTitle = typeof row.title === 'string' && row.title.trim() ? row.title : null;
    const rowSubtitle = typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle : null;
    const rowPosterUrl = typeof row.poster_url === 'string' && row.poster_url.trim() ? row.poster_url : null;
    const rowBackdropUrl = typeof row.backdrop_url === 'string' && row.backdrop_url.trim() ? row.backdrop_url : null;
    const canUseProjectionOnly = Boolean(
      rowTitle
      && (identity.mediaType !== 'episode' || rowSubtitle)
      && (rowPosterUrl || rowBackdropUrl),
    );

    if (source?.providerContext?.title) {
      return buildProviderMetadataCardView({
        identity: source.providerIdentity ?? identity,
        title: source.providerContext.title,
        currentEpisode: source.providerContext.currentEpisode,
      });
    }

    const context = canUseProjectionOnly
      ? { title: null, currentEpisode: null }
      : {
          title: source?.tmdbTitle ?? null,
          currentEpisode: source?.tmdbCurrentEpisode ?? null,
        };

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
}

function buildEpisodeSubtitle(seasonNumber: number | null, episodeNumber: number | null): string | null {
  if (seasonNumber === null || episodeNumber === null) {
    return null;
  }

  return `S${String(seasonNumber).padStart(2, '0')} E${String(episodeNumber).padStart(2, '0')}`;
}
