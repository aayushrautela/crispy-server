import type { DbClient } from '../../lib/db.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { MediaIdentity } from '../identity/media-key.js';
import { buildProviderEpisodeView } from './metadata-detail.builders.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { ProviderMetadataService } from './provider-metadata.service.js';
import { MetadataDetailCoreService } from './metadata-detail-core.service.js';
import { findNextEpisode } from './next-episode.js';
import { resolveShowRouteIdentity } from './metadata-detail.service.js';
import type {
  MetadataEpisodeListResponse,
  MetadataNextEpisodeResponse,
} from './metadata-detail.types.js';

export type NextEpisodeInput = {
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  watchedKeys?: string[] | null;
  showMediaKey?: string | null;
  nowMs?: number | null;
  language?: string | null;
};

export class EpisodeNavigationService {
  constructor(
    private readonly metadataDetailCoreService = new MetadataDetailCoreService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly providerMetadataService = new ProviderMetadataService(),
  ) {}

  async listEpisodes(id: string, requestedSeasonNumber?: number | null, language?: string | null): Promise<MetadataEpisodeListResponse> {
    return withDbClient(async (client) => {
      const showIdentity = await this.resolveShowIdentity(client, id);
      const providerContext = await this.providerMetadataService.loadIdentityContext(client, showIdentity, language ?? null);
      const resolvedTitle = providerContext?.title;
      if (!resolvedTitle) {
        throw new HttpError(404, 'Show metadata not found.');
      }

      const show = await this.metadataDetailCoreService.buildMetadataView(client, showIdentity, language ?? null);
      const seasonNumbers = selectProviderSeasonNumbers(providerContext.episodes, resolvedTitle.seasonCount, requestedSeasonNumber ?? null);
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
            ? [buildProviderEpisodeView(resolvedTitle, episode, contentId, '')]
            : [];
        }),
      };
    });
  }

  async getNextEpisode(id: string, input: NextEpisodeInput): Promise<MetadataNextEpisodeResponse> {
    const episodeList = await this.listEpisodes(id, input.currentSeasonNumber, input.language ?? null);
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
