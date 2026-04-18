import type { DbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { inferMediaIdentity, type MediaIdentity, type SupportedProvider } from '../identity/media-key.js';
import { WatchV2MetadataService } from './watch-v2-metadata.service.js';
import { deriveRuntimeDurationSeconds, WatchV2WriteRepository } from './watch-v2-write.service.js';
import type { WatchV2ProjectionRebuildSummary } from './watch-v2-projection-summary.js';

type TitleRow = {
  profileId: string;
  titleContentId: string;
  titleMediaKey: string;
  titleMediaType: 'movie' | 'show';
  titleProvider: SupportedProvider;
  titleProviderId: string;
};

export class WatchV2ProjectionRebuildService {
  constructor(
    private readonly repository = new WatchV2WriteRepository(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataService = new WatchV2MetadataService(),
  ) {}

  async rebuildProfile(client: DbClient, profileId: string): Promise<WatchV2ProjectionRebuildSummary> {
    await client.query('DELETE FROM profile_title_projection WHERE profile_id = $1::uuid', [profileId]);
    await client.query('DELETE FROM profile_episodic_follow_state WHERE profile_id = $1::uuid', [profileId]);

    const titles = await this.listTitlesToRebuild(client, profileId);
    let titleProjections = 0;
    let episodicFollowStates = 0;

    for (const title of titles) {
      const titleIdentity = inferMediaIdentity({
        contentId: title.titleContentId,
        mediaKey: title.titleMediaKey,
        mediaType: title.titleMediaType,
        provider: title.titleProvider,
        providerId: title.titleProviderId,
      });
      const titleProjection = await this.metadataService.buildProjection(client, titleIdentity);
      let aggregate = await this.repository.getProjectionAggregate(client, profileId, title.titleContentId);
      const activeIdentity = aggregate.activeState
        ? await this.resolvePlayableIdentity(client, aggregate.activeState.contentId).catch(() => null)
        : null;
      const activeProjection = activeIdentity ? await this.metadataService.buildProjection(client, activeIdentity) : null;
      const healedDurationSeconds = deriveRuntimeDurationSeconds(activeProjection);
      if (aggregate.activeState && aggregate.activeState.durationSeconds === null && healedDurationSeconds !== null) {
        await this.repository.backfillPlayableDuration(client, {
          profileId,
          contentId: aggregate.activeState.contentId,
          durationSeconds: healedDurationSeconds,
        });
        aggregate = {
          ...aggregate,
          activeState: {
            ...aggregate.activeState,
            durationSeconds: healedDurationSeconds,
          },
        };
      }
      const effectiveWatched = computeEffectiveWatched(aggregate);
      const keepProjection = Boolean(
        aggregate.activeState
        || aggregate.watchlist?.present
        || aggregate.rating?.rating !== null
        || effectiveWatched
        || aggregate.override?.overrideState === 'unwatched',
      );

      if (!keepProjection) {
        continue;
      }

      const seriesIdentity =
        title.titleMediaType === 'show'
          ? inferMediaIdentity({
              contentId: title.titleContentId,
              mediaKey: title.titleMediaKey,
              mediaType: title.titleMediaType,
              provider: title.titleProvider,
              providerId: title.titleProviderId,
            })
          : null;

      await this.metadataService.syncEpisodicFollowState(client, {
        profileId,
        titleContentId: title.titleContentId,
        titleMediaKey: title.titleMediaKey,
        seriesIdentity,
      });
      if (seriesIdentity) {
        episodicFollowStates += 1;
      }

      await this.repository.upsertTitleProjection(client, {
        profileId,
        titleContentId: title.titleContentId,
        titleKind: title.titleMediaType,
        titleIdentity: {
          contentId: title.titleContentId,
          mediaKey: title.titleMediaKey,
          mediaType: title.titleMediaType,
          provider: title.titleProvider,
          providerId: title.titleProviderId,
        },
        titleProjection,
        activeIdentity,
        activeProjection,
        aggregate,
      });
      titleProjections += 1;
    }

    return {
      titleProjections,
      trackedTitleStates: episodicFollowStates,
    };
  }

  private async listTitlesToRebuild(client: DbClient, profileId: string): Promise<TitleRow[]> {
    const result = await client.query(
      `
        WITH titles AS (
          SELECT profile_id, title_content_id
          FROM profile_playable_state
          WHERE profile_id = $1::uuid
          UNION
          SELECT profile_id, target_content_id AS title_content_id
          FROM profile_watch_override
          WHERE profile_id = $1::uuid AND target_kind IN ('movie', 'show', 'anime')
          UNION
          SELECT profile_id, target_content_id AS title_content_id
          FROM profile_watchlist_state
          WHERE profile_id = $1::uuid
          UNION
          SELECT profile_id, target_content_id AS title_content_id
          FROM profile_rating_state
          WHERE profile_id = $1::uuid
          UNION
          SELECT profile_id, title_content_id
          FROM profile_play_history
          WHERE profile_id = $1::uuid AND voided_at IS NULL
        )
        SELECT DISTINCT profile_id::text AS profile_id, title_content_id::text AS title_content_id
        FROM titles
      `,
      [profileId],
    );

    const rows: TitleRow[] = [];
    for (const row of result.rows) {
      const titleContentId = String(row.title_content_id);
      const reference = await this.contentIdentityService.resolveContentReference(client, titleContentId);
      if (!('mediaIdentity' in reference)) {
        continue;
      }
      const identity = reference.mediaIdentity;
      if (identity.mediaType !== 'movie' && identity.mediaType !== 'show') {
        continue;
      }
      rows.push({
        profileId: String(row.profile_id),
        titleContentId,
        titleMediaKey: identity.mediaKey,
        titleMediaType: identity.mediaType,
        titleProvider: (identity.provider ?? 'tmdb') as SupportedProvider,
        titleProviderId: identity.providerId ?? identity.mediaKey,
      });
    }

    return rows;
  }

  private async resolvePlayableIdentity(client: DbClient, contentId: string): Promise<MediaIdentity> {
    const reference = await this.contentIdentityService.resolveContentReference(client, contentId);
    if ('mediaIdentity' in reference) {
      return reference.mediaIdentity;
    }
    throw new Error(`Unsupported playable content id ${contentId}`);
  }
}

function computeEffectiveWatched(aggregate: Awaited<ReturnType<WatchV2WriteRepository['getProjectionAggregate']>>): boolean {
  if (aggregate.override?.overrideState === 'watched') {
    return true;
  }
  if (aggregate.override?.overrideState === 'unwatched') {
    return false;
  }

  return Boolean(aggregate.lastPlayableCompletedAt || aggregate.lastHistoryCompletedAt || aggregate.activeState?.playbackStatus === 'completed');
}
