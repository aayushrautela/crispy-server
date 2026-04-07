import type { DbClient } from '../../lib/db.js';
import { logger } from '../../config/logger.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import { parentMediaTypeForIdentity, type MediaIdentity } from '../identity/media-key.js';
import type { WatchMediaProjection } from '../watch/watch.types.js';
import { WatchMediaCardCacheService } from '../watch/watch-media-card-cache.service.js';

export class WatchV2MetadataService {
  constructor(
    private readonly metadataProjectionService = new MetadataProjectionService(),
    private readonly watchMediaCardCacheService = new WatchMediaCardCacheService(),
  ) {}

  async buildProjection(client: DbClient, identity: MediaIdentity): Promise<WatchMediaProjection> {
    const projection = await this.metadataProjectionService
      .buildWatchProjection(client, identity)
      .catch((error) => {
        logger.warn({
          err: error,
          mediaKey: identity.mediaKey,
          mediaType: identity.mediaType,
          provider: identity.provider,
          providerId: identity.providerId,
          parentProvider: identity.parentProvider,
          parentProviderId: identity.parentProviderId,
          tmdbId: identity.tmdbId,
          showTmdbId: identity.showTmdbId,
          seasonNumber: identity.seasonNumber,
          episodeNumber: identity.episodeNumber,
        }, 'failed to build watch metadata projection, using fallback projection');
        return fallbackProjection(identity);
      });

    await this.watchMediaCardCacheService.upsertFromProjection(client, identity, projection);
    return projection;
  }

  async syncEpisodicFollowState(
    client: DbClient,
    input: { profileId: string; titleContentId: string; titleMediaKey: string; seriesIdentity: MediaIdentity | null },
  ): Promise<void> {
    if (!input.seriesIdentity || (input.seriesIdentity.mediaType !== 'show' && input.seriesIdentity.mediaType !== 'anime')) {
      await this.deleteEpisodicFollowState(client, input.profileId, input.titleContentId);
      return;
    }

    const nextEpisodeAirDate = await this.metadataProjectionService.resolveNextEpisodeAirDate(client, input.seriesIdentity);
    await this.upsertEpisodicFollowState(client, {
      profileId: input.profileId,
      titleContentId: input.titleContentId,
      titleMediaKey: input.titleMediaKey,
      nextEpisodeAirDate,
      metadataRefreshedAt: new Date().toISOString(),
      payload: {},
    });
  }

  async upsertEpisodicFollowState(
    client: DbClient,
    input: {
      profileId: string;
      titleContentId: string;
      titleMediaKey: string;
      nextEpisodeAirDate: string | null;
      metadataRefreshedAt: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_episodic_follow_state (
          profile_id,
          title_content_id,
          title_media_key,
          next_episode_air_date,
          metadata_refreshed_at,
          payload,
          updated_at
        )
        VALUES ($1, $2, $3, $4::date, $5::timestamptz, $6::jsonb, NOW())
        ON CONFLICT (profile_id, title_content_id)
        DO UPDATE SET
          title_media_key = EXCLUDED.title_media_key,
          next_episode_air_date = EXCLUDED.next_episode_air_date,
          metadata_refreshed_at = EXCLUDED.metadata_refreshed_at,
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `,
      [
        input.profileId,
        input.titleContentId,
        input.titleMediaKey,
        input.nextEpisodeAirDate,
        input.metadataRefreshedAt,
        JSON.stringify(input.payload ?? {}),
      ],
    );
  }

  async deleteEpisodicFollowState(client: DbClient, profileId: string, titleContentId: string): Promise<void> {
    await client.query(
      `DELETE FROM profile_episodic_follow_state WHERE profile_id = $1 AND title_content_id = $2`,
      [profileId, titleContentId],
    );
  }
}

function fallbackProjection(identity: MediaIdentity): WatchMediaProjection {
  const detailsTitleMediaType =
    identity.mediaType === 'season' || identity.mediaType === 'episode'
      ? parentMediaTypeForIdentity(identity)
      : identity.mediaType;
  const playbackMediaType =
    identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'episode' || identity.mediaType === 'anime'
      ? identity.mediaType
      : null;

  return {
    detailsTitleMediaType,
    playbackMediaType,
    playbackProvider: identity.provider ?? null,
    playbackProviderId: identity.providerId ?? null,
    playbackParentProvider: identity.parentProvider ?? null,
    playbackParentProviderId: identity.parentProviderId ?? null,
    playbackSeasonNumber: identity.seasonNumber ?? null,
    playbackEpisodeNumber: identity.episodeNumber ?? null,
    playbackAbsoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
    detailsStillUrl: null,
    detailsReleaseYear: null,
    detailsRuntimeMinutes: null,
    detailsRating: null,
    episodeTitle: null,
    episodeAirDate: null,
    episodeRuntimeMinutes: null,
    episodeStillUrl: null,
    title: null,
    subtitle: null,
    posterUrl: null,
    backdropUrl: null,
  };
}
