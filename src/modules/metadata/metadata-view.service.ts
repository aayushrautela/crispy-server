import type { DbClient } from '../../lib/db.js';
import { ensureSupportedMediaType, type MediaIdentity } from '../watch/media-key.js';
import { assertPresent } from '../../lib/errors.js';
import {
  buildMetadataCardView,
  buildEpisodeView,
  buildMetadataView,
  buildSeasonViewFromRecord,
  buildSeasonViewFromTitleRaw,
} from './metadata-normalizers.js';
import { extractNextEpisodeToAir } from './tmdb-episode-helpers.js';
import { TmdbCacheService } from './tmdb-cache.service.js';
import type {
  MetadataCardView,
  MetadataEpisodeView,
  MetadataSeasonDetail,
  MetadataTitleDetail,
  MetadataView,
  TmdbEpisodeRecord,
  TmdbTitleRecord,
} from './tmdb.types.js';

export class MetadataViewService {
  constructor(private readonly tmdbCacheService = new TmdbCacheService()) {}

  async buildMetadataCardView(client: DbClient, identity: MediaIdentity): Promise<MetadataCardView> {
    const context = await this.loadCardContext(client, identity);
    return buildMetadataCardView({
      identity,
      title: context.title,
      currentEpisode: context.currentEpisode,
    });
  }

  async buildMetadataCardViewFromRow(client: DbClient, row: Record<string, unknown>): Promise<MetadataCardView> {
    const identity = this.identityFromRow(row);
    const rowTitle = typeof row.title === 'string' && row.title.trim() ? row.title : null;
    const rowSubtitle = typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle : null;
    const rowPosterUrl = typeof row.poster_url === 'string' && row.poster_url.trim() ? row.poster_url : null;
    const rowBackdropUrl = typeof row.backdrop_url === 'string' && row.backdrop_url.trim() ? row.backdrop_url : null;
    const canUseProjectionOnly = Boolean(
      rowTitle
      && (identity.mediaType !== 'episode' || rowSubtitle)
      && (rowPosterUrl || rowBackdropUrl),
    );
    const context = canUseProjectionOnly
      ? { title: null, currentEpisode: null }
      : await this.loadCardContext(client, identity);

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

  async buildMetadataView(client: DbClient, identity: MediaIdentity): Promise<MetadataView> {
    const { title, currentEpisode, nextEpisode } = await this.loadIdentityContext(client, identity);

    return buildMetadataView({
      identity,
      title,
      currentEpisode,
      nextEpisode,
    });
  }

  async getTitleDetail(client: DbClient, identity: MediaIdentity): Promise<MetadataTitleDetail> {
    const normalizedIdentity = identity.mediaType === 'episode'
      ? { ...identity, mediaType: 'show' as const, tmdbId: identity.showTmdbId, seasonNumber: null, episodeNumber: null }
      : identity;
    const { title, nextEpisode } = await this.loadIdentityContext(client, normalizedIdentity);
    const resolvedTitle = assertPresent(title, 'Metadata title not found.');

    return {
      item: buildMetadataView({
        identity: normalizedIdentity,
        title: resolvedTitle,
        currentEpisode: null,
        nextEpisode,
      }),
      seasons: buildSeasonViewFromTitleRaw(resolvedTitle),
    };
  }

  async getSeasonDetail(client: DbClient, showTmdbId: number, seasonNumber: number): Promise<MetadataSeasonDetail> {
    const showIdentity: MediaIdentity = {
      mediaKey: `show:tmdb:${showTmdbId}`,
      mediaType: 'show',
      tmdbId: showTmdbId,
      showTmdbId,
      seasonNumber: null,
      episodeNumber: null,
    };

    const { title, nextEpisode } = await this.loadIdentityContext(client, showIdentity);
    const resolvedTitle = assertPresent(title, 'Show metadata not found.');
    const seasonRecord = await this.tmdbCacheService.ensureSeasonCached(client, showTmdbId, seasonNumber);
    const resolvedSeason = assertPresent(seasonRecord, 'Season metadata not found.');
    const episodes = await this.tmdbCacheService.listEpisodesForSeason(client, showTmdbId, seasonNumber);

    return {
      show: buildMetadataView({
        identity: showIdentity,
        title: resolvedTitle,
        currentEpisode: null,
        nextEpisode,
      }),
      season: buildSeasonViewFromRecord(showTmdbId, resolvedSeason),
      episodes: episodes.map((episode) => buildEpisodeView(resolvedTitle, episode)),
    };
  }

  async buildViews(client: DbClient, identities: MediaIdentity[]): Promise<MetadataView[]> {
    return Promise.all(identities.map((identity) => this.buildMetadataView(client, identity)));
  }

  async buildCardViews(client: DbClient, identities: MediaIdentity[]): Promise<MetadataCardView[]> {
    return Promise.all(identities.map((identity) => this.buildMetadataCardView(client, identity)));
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
    return {
      mediaKey: String(row.media_key),
      mediaType: ensureSupportedMediaType(String(row.media_type)),
      tmdbId: row.tmdb_id === null || row.tmdb_id === undefined ? null : Number(row.tmdb_id),
      showTmdbId: row.show_tmdb_id === null || row.show_tmdb_id === undefined ? null : Number(row.show_tmdb_id),
      seasonNumber: row.season_number === null || row.season_number === undefined ? null : Number(row.season_number),
      episodeNumber: row.episode_number === null || row.episode_number === undefined ? null : Number(row.episode_number),
    };
  }

  private async loadIdentityContext(client: DbClient, identity: MediaIdentity): Promise<{
    title: TmdbTitleRecord | null;
    currentEpisode: TmdbEpisodeRecord | null;
    nextEpisode: TmdbEpisodeRecord | null;
    episodes: MetadataEpisodeView[] | null;
  }> {
    const titleType = identity.mediaType === 'movie' ? 'movie' : 'tv';
    const titleTmdbId = identity.mediaType === 'episode' ? identity.showTmdbId : identity.tmdbId;
    const title = titleTmdbId ? await this.tmdbCacheService.getTitle(client, titleType, titleTmdbId) : null;

    let currentEpisode: TmdbEpisodeRecord | null = null;
    let nextEpisode: TmdbEpisodeRecord | null = null;
    let mappedEpisodes: MetadataEpisodeView[] | null = null;

    if (identity.showTmdbId) {
      const seasonsToEnsure = collectRelevantSeasonNumbers(identity, title);
      for (const seasonNumber of seasonsToEnsure) {
        await this.tmdbCacheService.ensureSeasonCached(client, identity.showTmdbId, seasonNumber);
      }

      const episodes = await this.tmdbCacheService.listEpisodesForShow(client, identity.showTmdbId);
      if (identity.seasonNumber !== null && identity.episodeNumber !== null) {
        currentEpisode = episodes.find(
          (episode) => episode.seasonNumber === identity.seasonNumber && episode.episodeNumber === identity.episodeNumber,
        ) ?? null;
      }
      if (identity.mediaType === 'episode') {
        nextEpisode = selectNextEpisode(identity, title, episodes);
      }

      if (title) {
        mappedEpisodes = episodes.map((episode) => buildEpisodeView(title, episode));
      }
    }

    return {
      title,
      currentEpisode,
      nextEpisode,
      episodes: mappedEpisodes,
    };
  }
}

function buildEpisodeSubtitle(seasonNumber: number | null, episodeNumber: number | null): string | null {
  if (seasonNumber === null || episodeNumber === null) {
    return null;
  }

  return `S${String(seasonNumber).padStart(2, '0')} E${String(episodeNumber).padStart(2, '0')}`;
}

function collectRelevantSeasonNumbers(identity: MediaIdentity, title: TmdbTitleRecord | null): number[] {
  const seasons = new Set<number>();

  if (identity.seasonNumber && identity.seasonNumber > 0) {
    seasons.add(identity.seasonNumber);
  }

  const nextEpisode = extractNextEpisodeToAir(title);
  if (nextEpisode?.seasonNumber) {
    seasons.add(nextEpisode.seasonNumber);
  }

  if (seasons.size === 0 && title?.numberOfSeasons && title.numberOfSeasons > 0) {
    seasons.add(title.numberOfSeasons);
  }

  return Array.from(seasons).sort((left, right) => left - right);
}

function selectNextEpisode(
  identity: MediaIdentity,
  title: TmdbTitleRecord | null,
  episodes: TmdbEpisodeRecord[],
): TmdbEpisodeRecord | null {
  const tmdbNextEpisode = extractNextEpisodeToAir(title);
  if (tmdbNextEpisode) {
    return tmdbNextEpisode;
  }

  return episodes.find((episode) => {
    if (!episode.airDate || Date.parse(episode.airDate) > Date.now()) {
      return false;
    }
    if (episode.seasonNumber < (identity.seasonNumber ?? 0)) {
      return false;
    }
    if (episode.seasonNumber === identity.seasonNumber && episode.episodeNumber <= (identity.episodeNumber ?? 0)) {
      return false;
    }
    return true;
  }) ?? null;
}
