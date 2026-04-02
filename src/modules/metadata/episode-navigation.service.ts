import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { assertPresent, HttpError } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import {
  buildEpisodeView,
  buildProviderEpisodeView,
} from './metadata-detail.builders.js';
import { ContentIdentityService, episodeRefMapKey } from '../identity/content-identity.service.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { findNextEpisode } from './next-episode.js';
import { TmdbCacheService } from './providers/tmdb-cache.service.js';
import { resolveShowRouteIdentity } from './metadata-detail.service.js';
import type {
  MetadataEpisodeListResponse,
  MetadataNextEpisodeResponse,
} from './metadata-detail.types.js';
import type {
  TmdbEpisodeRecord,
  TmdbTitleRecord,
} from './providers/tmdb.types.js';

export type NextEpisodeInput = {
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  watchedKeys?: string[] | null;
  showMediaKey?: string | null;
  nowMs?: number | null;
};

export class EpisodeNavigationService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly tmdbCacheService = new TmdbCacheService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async listEpisodes(id: string, requestedSeasonNumber?: number | null): Promise<MetadataEpisodeListResponse> {
    return withDbClient(async (client) => {
      const showIdentity = await this.resolveShowIdentity(client, id);
      const providerContext = await this.providerMetadataService.loadIdentityContext(client, showIdentity);
      if (providerContext?.title) {
        const show = await this.metadataDetailCoreService.buildMetadataView(client, showIdentity);
        const seasonNumbers = selectProviderSeasonNumbers(providerContext.episodes, providerContext.title.seasonCount, requestedSeasonNumber ?? null);
        const filteredEpisodes = providerContext.episodes.filter((episode) => seasonNumbers.includes(episode.seasonNumber ?? 1));
        const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
          client,
          filteredEpisodes.map((episode) => ({
            parentMediaType: episode.parentMediaType,
            provider: episode.provider,
            parentProviderId: episode.parentProviderId,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
          })),
        );

        return {
          show,
          requestedSeasonNumber: requestedSeasonNumber ?? null,
          effectiveSeasonNumber: seasonNumbers[0] ?? 1,
          includedSeasonNumbers: seasonNumbers,
          episodes: filteredEpisodes.flatMap((episode) => {
            const contentId = episodeIds.get(episode.providerId);
            return contentId
              ? [buildProviderEpisodeView(providerContext.title!, episode, contentId, '')]
              : [];
          }),
        };
      }

      const showTmdbId = assertPresent(showIdentity.tmdbId, 'Show metadata not found.');
      const title = assertPresent(
        await this.tmdbCacheService.ensureTitleCached(client, 'tv', showTmdbId),
        'Show metadata not found.',
      );
      const seasonNumbers = selectEpisodeSeasonNumbers(title, requestedSeasonNumber ?? null);
      const episodes: TmdbEpisodeRecord[] = [];
      for (const seasonNumber of seasonNumbers) {
        await this.tmdbCacheService.ensureSeasonCached(client, showTmdbId, seasonNumber);
        episodes.push(...await this.tmdbCacheService.listEpisodesForSeason(client, showTmdbId, seasonNumber));
      }

      const show = await this.metadataDetailCoreService.buildMetadataView(client, showIdentity);
      const dedupedEpisodes = dedupeEpisodes(episodes);
      const episodeIds = await this.contentIdentityService.ensureEpisodeContentIds(
        client,
        dedupedEpisodes.map((episode) => ({
          parentMediaType: 'show' as const,
          provider: 'tmdb' as const,
          parentProviderId: episode.showTmdbId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
        })),
      );
      const uniqueEpisodes = dedupedEpisodes.map((episode) => buildEpisodeView(
        title,
        episode,
        assertPresent(
          episodeIds.get(episodeRefMapKey(episode.showTmdbId, episode.seasonNumber, episode.episodeNumber)),
          'Episode metadata not found.',
        ),
        '',
      ));

      return {
        show,
        requestedSeasonNumber: requestedSeasonNumber ?? null,
        effectiveSeasonNumber: seasonNumbers[0] ?? 1,
        includedSeasonNumbers: seasonNumbers,
        episodes: uniqueEpisodes,
      };
    });
  }

  async getNextEpisode(id: string, input: NextEpisodeInput): Promise<MetadataNextEpisodeResponse> {
    const episodeList = await this.listEpisodes(id, input.currentSeasonNumber);
    const nextEpisode = findNextEpisode({
      currentSeasonNumber: input.currentSeasonNumber,
      currentEpisodeNumber: input.currentEpisodeNumber,
      episodes: episodeList.episodes.map((episode) => ({
        ...episode,
        releaseDate: episode.airDate,
      })),
      watchedKeys: input.watchedKeys ?? null,
      showId: input.showMediaKey ?? episodeList.show.mediaKey,
      nowMs: input.nowMs ?? null,
    });

    return {
      show: episodeList.show,
      currentSeasonNumber: input.currentSeasonNumber,
      currentEpisodeNumber: input.currentEpisodeNumber,
      item: nextEpisode
        ? episodeList.episodes.find((episode) => episode.providerId === nextEpisode.providerId) ?? null
        : null,
    };
  }

  private async resolveShowIdentity(client: DbClient, id: string): Promise<MediaIdentity & { mediaType: 'show' | 'anime' }> {
    const parsed = await resolveShowRouteIdentity(client, this.contentIdentityService, id);
    if (parsed.mediaType === 'show' || parsed.mediaType === 'anime') {
      return {
        ...parsed,
        mediaType: parsed.mediaType,
      };
    }
    throw new HttpError(400, 'Episode listing requires a show or anime mediaKey.');
  }
}

function selectEpisodeSeasonNumbers(title: TmdbTitleRecord, requestedSeasonNumber: number | null): number[] {
  const maxSeasonNumber = title.numberOfSeasons && title.numberOfSeasons > 0 ? title.numberOfSeasons : null;
  const effectiveSeasonNumber = requestedSeasonNumber && requestedSeasonNumber > 0
    ? maxSeasonNumber ? Math.min(requestedSeasonNumber, maxSeasonNumber) : requestedSeasonNumber
    : maxSeasonNumber ?? 1;
  const seasons = [Math.max(1, effectiveSeasonNumber)];

  if (requestedSeasonNumber && maxSeasonNumber && effectiveSeasonNumber < maxSeasonNumber) {
    seasons.push(effectiveSeasonNumber + 1);
  }

  return Array.from(new Set(seasons)).sort((left, right) => left - right);
}

function dedupeEpisodes(episodes: TmdbEpisodeRecord[]): TmdbEpisodeRecord[] {
  const deduped = new Map<string, TmdbEpisodeRecord>();
  for (const episode of episodes) {
    deduped.set(`${episode.seasonNumber}:${episode.episodeNumber}`, episode);
  }
  return [...deduped.values()].sort((left, right) => {
    if (left.seasonNumber !== right.seasonNumber) {
      return left.seasonNumber - right.seasonNumber;
    }
    return left.episodeNumber - right.episodeNumber;
  });
}

function selectProviderSeasonNumbers(
  episodes: Array<{ seasonNumber: number | null }>,
  seasonCount: number | null,
  requestedSeasonNumber: number | null,
): number[] {
  if (requestedSeasonNumber && requestedSeasonNumber > 0) {
    return [requestedSeasonNumber];
  }

  const values = new Set<number>();
  for (const episode of episodes) {
    values.add(episode.seasonNumber ?? 1);
  }

  if (!values.size && seasonCount && seasonCount > 0) {
    for (let seasonNumber = 1; seasonNumber <= seasonCount; seasonNumber += 1) {
      values.add(seasonNumber);
    }
  }

  if (!values.size) {
    values.add(1);
  }

  return Array.from(values).sort((left, right) => left - right);
}
