import type { DbClient } from '../../lib/db.js';
import type { MediaIdentity } from '../watch/media-key.js';
import { assertPresent } from '../../lib/errors.js';
import {
  buildEpisodeView,
  buildMetadataView,
  buildSeasonViewFromRecord,
  buildSeasonViewFromTitleRaw,
} from './metadata-normalizers.js';
import { extractNextEpisodeToAir } from './tmdb-episode-helpers.js';
import { TmdbCacheService } from './tmdb-cache.service.js';
import type {
  MetadataEpisodeView,
  MetadataSeasonDetail,
  MetadataTitleDetail,
  MetadataView,
  TmdbEpisodeRecord,
  TmdbTitleRecord,
} from './tmdb.types.js';

export class MetadataViewService {
  constructor(private readonly tmdbCacheService = new TmdbCacheService()) {}

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
