import type { DbClient } from '../../lib/db.js';
import { normalizeIsoString } from '../../lib/time.js';
import { deriveProgressPercent } from '../watch/heartbeat-policy.js';
import type { WatchMediaProjection } from '../watch/watch.types.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import {
  inferMediaIdentity,
  parentMediaTypeForIdentity,
  showTmdbIdForIdentity,
  type MediaIdentity,
} from '../identity/media-key.js';
import type { ProviderImportProvider } from '../integrations/provider-import.types.js';
import type {
  WatchV2PlayableStatus,
  WatchV2ResolvedTarget,
  WatchV2SourceKind,
  WatchV2TargetKind,
  WatchV2TitleIdentity,
  WatchV2TitleKind,
} from './watch-v2.types.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import { WatchV2MetadataService } from './watch-v2-metadata.service.js';

type PlayableStateSnapshot = {
  contentId: string;
  playbackStatus: WatchV2PlayableStatus;
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number;
  playCount: number;
  lastCompletedAt: string | null;
  lastActivityAt: string;
  dismissedAt: string | null;
};

type OverrideSnapshot = {
  overrideState: 'watched' | 'unwatched';
  sourceUpdatedAt: string;
};

type WatchlistSnapshot = {
  present: boolean;
  changedAt: string | null;
};

type RatingSnapshot = {
  rating: number | null;
  changedAt: string | null;
};

type ProjectionAggregate = {
  activeState: PlayableStateSnapshot | null;
  override: OverrideSnapshot | null;
  watchlist: WatchlistSnapshot | null;
  rating: RatingSnapshot | null;
  lastPlayableCompletedAt: string | null;
  lastHistoryCompletedAt: string | null;
};

type UpsertPlayableStateParams = {
  profileId: string;
  contentId: string;
  titleContentId: string;
  playbackStatus: WatchV2PlayableStatus;
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number;
  playCount: number;
  firstCompletedAt: string | null;
  lastCompletedAt: string | null;
  lastActivityAt: string;
  dismissedAt: string | null;
  lastMutationSeq: number;
  sourceKind: WatchV2SourceKind;
  sourceProvider: ProviderImportProvider | null;
  sourceUpdatedAt: string;
};

type UpsertOverrideParams = {
  profileId: string;
  targetContentId: string;
  targetKind: WatchV2TargetKind;
  overrideState: 'watched' | 'unwatched';
  scope: 'self' | 'released_descendants';
  appliesThroughReleaseAt: string | null;
  lastMutationSeq: number;
  sourceKind: WatchV2SourceKind;
  sourceProvider: ProviderImportProvider | null;
  sourceUpdatedAt: string;
};

type UpsertWatchlistParams = {
  profileId: string;
  targetContentId: string;
  targetKind: WatchV2TitleKind;
  present: boolean;
  addedAt: string | null;
  removedAt: string | null;
  lastMutationSeq: number;
  sourceKind: WatchV2SourceKind;
  sourceProvider: ProviderImportProvider | null;
  sourceUpdatedAt: string;
};

type UpsertRatingParams = {
  profileId: string;
  targetContentId: string;
  targetKind: WatchV2TitleKind;
  rating: number | null;
  ratedAt: string | null;
  removedAt: string | null;
  lastMutationSeq: number;
  sourceKind: WatchV2SourceKind;
  sourceProvider: ProviderImportProvider | null;
  sourceUpdatedAt: string;
};

type ProjectionUpsertParams = {
  profileId: string;
  titleContentId: string;
  titleKind: WatchV2TitleKind;
  titleIdentity: WatchV2TitleIdentity;
  titleProjection: WatchMediaProjection;
  activeIdentity: MediaIdentity | null;
  activeProjection: WatchMediaProjection | null;
  aggregate: ProjectionAggregate;
};

export class WatchV2WriteService {
  constructor(
    private readonly repository = new WatchV2WriteRepository(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataProjectionService = new MetadataProjectionService(),
    private readonly metadataService = new WatchV2MetadataService(this.metadataProjectionService),
  ) {}

  async applyPlaybackEvent(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    eventType: string;
    occurredAt: string;
    positionSeconds?: number | null;
    durationSeconds?: number | null;
    sourceKind?: WatchV2SourceKind;
    sourceProvider?: ProviderImportProvider | null;
  }): Promise<void> {
    const resolved = await this.resolveTarget(client, params.identity);
    const projection = await this.buildProjection(client, params.identity);
    const lastMutationSeq = await this.repository.reserveMutationSequence(client, params.profileId);
    const current = isPlayableTarget(resolved.mediaType)
      ? await this.repository.getPlayableState(client, params.profileId, resolved.contentId)
      : null;

    const progressPercent = deriveProgressPercent(params.positionSeconds, params.durationSeconds);
    const completed = params.eventType === 'playback_completed' || progressPercent >= 90;
    const playbackStatus = completed
      ? 'completed'
      : (params.positionSeconds ?? 0) > 0
        ? 'in_progress'
        : 'idle';
    const lastCompletedAt = completed ? params.occurredAt : current?.lastCompletedAt ?? null;
    const playCount = completed ? (current?.playCount ?? 0) + 1 : (current?.playCount ?? 0);

    if (isPlayableTarget(resolved.mediaType)) {
      await this.repository.upsertPlayableState(client, {
        profileId: params.profileId,
        contentId: resolved.contentId,
        titleContentId: resolved.titleContentId,
        playbackStatus,
        positionSeconds: completed ? 0 : Math.max(0, params.positionSeconds ?? 0),
        durationSeconds: params.durationSeconds ?? null,
        progressPercent: completed ? 100 : progressPercent,
        playCount,
        firstCompletedAt: completed ? (current?.lastCompletedAt ?? params.occurredAt) : null,
        lastCompletedAt,
        lastActivityAt: params.occurredAt,
        dismissedAt: null,
        lastMutationSeq,
        sourceKind: params.sourceKind ?? 'local',
        sourceProvider: params.sourceProvider ?? null,
        sourceUpdatedAt: params.occurredAt,
      });
    }

    if (completed) {
      await this.repository.insertPlayHistory(client, {
        profileId: params.profileId,
        contentId: resolved.contentId,
        titleContentId: resolved.titleContentId,
        completedAt: params.occurredAt,
        lastMutationSeq,
        sourceKind: params.sourceKind ?? 'local',
        sourceProvider: params.sourceProvider ?? null,
      });
    }

    await this.refreshProjection(client, params.profileId, resolved, projection);
  }

  async markWatched(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    occurredAt: string;
    sourceKind?: WatchV2SourceKind;
    sourceProvider?: ProviderImportProvider | null;
  }): Promise<void> {
    const resolved = await this.resolveTarget(client, params.identity);
    const projection = await this.buildProjection(client, params.identity);
    const lastMutationSeq = await this.repository.reserveMutationSequence(client, params.profileId);

    await this.repository.upsertWatchOverride(client, {
      profileId: params.profileId,
      targetContentId: resolved.contentId,
      targetKind: resolved.mediaType,
      overrideState: 'watched',
      scope: isTitleTarget(resolved.mediaType) ? 'released_descendants' : 'self',
      appliesThroughReleaseAt: isTitleTarget(resolved.mediaType) ? params.occurredAt : null,
      lastMutationSeq,
      sourceKind: params.sourceKind ?? 'local',
      sourceProvider: params.sourceProvider ?? null,
      sourceUpdatedAt: params.occurredAt,
    });

    if (isPlayableTarget(resolved.mediaType)) {
      const current = await this.repository.getPlayableState(client, params.profileId, resolved.contentId);
      await this.repository.upsertPlayableState(client, {
        profileId: params.profileId,
        contentId: resolved.contentId,
        titleContentId: resolved.titleContentId,
        playbackStatus: 'completed',
        positionSeconds: 0,
        durationSeconds: current?.durationSeconds ?? null,
        progressPercent: 100,
        playCount: (current?.playCount ?? 0) + 1,
        firstCompletedAt: current?.lastCompletedAt ?? params.occurredAt,
        lastCompletedAt: params.occurredAt,
        lastActivityAt: params.occurredAt,
        dismissedAt: null,
        lastMutationSeq,
        sourceKind: params.sourceKind ?? 'local',
        sourceProvider: params.sourceProvider ?? null,
        sourceUpdatedAt: params.occurredAt,
      });
    }

    await this.repository.insertPlayHistory(client, {
      profileId: params.profileId,
      contentId: resolved.contentId,
      titleContentId: resolved.titleContentId,
      completedAt: params.occurredAt,
      lastMutationSeq,
      sourceKind: params.sourceKind ?? 'local',
      sourceProvider: params.sourceProvider ?? null,
    });

    await this.refreshProjection(client, params.profileId, resolved, projection);
  }

  async unmarkWatched(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    occurredAt: string;
    sourceKind?: WatchV2SourceKind;
    sourceProvider?: ProviderImportProvider | null;
  }): Promise<void> {
    const resolved = await this.resolveTarget(client, params.identity);
    const projection = await this.buildProjection(client, params.identity);
    const lastMutationSeq = await this.repository.reserveMutationSequence(client, params.profileId);

    await this.repository.upsertWatchOverride(client, {
      profileId: params.profileId,
      targetContentId: resolved.contentId,
      targetKind: resolved.mediaType,
      overrideState: 'unwatched',
      scope: isTitleTarget(resolved.mediaType) ? 'released_descendants' : 'self',
      appliesThroughReleaseAt: isTitleTarget(resolved.mediaType) ? params.occurredAt : null,
      lastMutationSeq,
      sourceKind: params.sourceKind ?? 'local',
      sourceProvider: params.sourceProvider ?? null,
      sourceUpdatedAt: params.occurredAt,
    });

    if (isTitleTarget(resolved.mediaType)) {
      await this.repository.deletePlayableStateByTitle(client, params.profileId, resolved.titleContentId);
      await this.repository.voidPlayHistoryByTitle(client, params.profileId, resolved.titleContentId, params.occurredAt);
    } else {
      await this.repository.deletePlayableState(client, params.profileId, resolved.contentId);
      await this.repository.voidPlayHistory(client, params.profileId, resolved.contentId, params.occurredAt);
    }

    await this.refreshProjection(client, params.profileId, resolved, projection);
  }

  async setWatchlist(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    occurredAt: string;
    sourceKind?: WatchV2SourceKind;
    sourceProvider?: ProviderImportProvider | null;
  }): Promise<void> {
    const resolved = await this.resolveTarget(client, params.identity);
    const projection = await this.buildProjection(client, params.identity);
    const lastMutationSeq = await this.repository.reserveMutationSequence(client, params.profileId);

    await this.repository.upsertWatchlistState(client, {
      profileId: params.profileId,
      targetContentId: resolved.titleContentId,
      targetKind: resolved.title.mediaType,
      present: true,
      addedAt: params.occurredAt,
      removedAt: null,
      lastMutationSeq,
      sourceKind: params.sourceKind ?? 'local',
      sourceProvider: params.sourceProvider ?? null,
      sourceUpdatedAt: params.occurredAt,
    });

    await this.refreshProjection(client, params.profileId, resolved, projection);
  }

  async removeWatchlist(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    occurredAt: string;
    sourceKind?: WatchV2SourceKind;
    sourceProvider?: ProviderImportProvider | null;
  }): Promise<void> {
    const resolved = await this.resolveTarget(client, params.identity);
    const projection = await this.buildProjection(client, params.identity);
    const lastMutationSeq = await this.repository.reserveMutationSequence(client, params.profileId);

    await this.repository.upsertWatchlistState(client, {
      profileId: params.profileId,
      targetContentId: resolved.titleContentId,
      targetKind: resolved.title.mediaType,
      present: false,
      addedAt: null,
      removedAt: params.occurredAt,
      lastMutationSeq,
      sourceKind: params.sourceKind ?? 'local',
      sourceProvider: params.sourceProvider ?? null,
      sourceUpdatedAt: params.occurredAt,
    });

    await this.refreshProjection(client, params.profileId, resolved, projection);
  }

  async setRating(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    rating: number;
    occurredAt: string;
    sourceKind?: WatchV2SourceKind;
    sourceProvider?: ProviderImportProvider | null;
  }): Promise<void> {
    const resolved = await this.resolveTarget(client, params.identity);
    const projection = await this.buildProjection(client, params.identity);
    const lastMutationSeq = await this.repository.reserveMutationSequence(client, params.profileId);

    await this.repository.upsertRatingState(client, {
      profileId: params.profileId,
      targetContentId: resolved.titleContentId,
      targetKind: resolved.title.mediaType,
      rating: params.rating,
      ratedAt: params.occurredAt,
      removedAt: null,
      lastMutationSeq,
      sourceKind: params.sourceKind ?? 'local',
      sourceProvider: params.sourceProvider ?? null,
      sourceUpdatedAt: params.occurredAt,
    });

    await this.refreshProjection(client, params.profileId, resolved, projection);
  }

  async removeRating(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    occurredAt: string;
    sourceKind?: WatchV2SourceKind;
    sourceProvider?: ProviderImportProvider | null;
  }): Promise<void> {
    const resolved = await this.resolveTarget(client, params.identity);
    const projection = await this.buildProjection(client, params.identity);
    const lastMutationSeq = await this.repository.reserveMutationSequence(client, params.profileId);

    await this.repository.upsertRatingState(client, {
      profileId: params.profileId,
      targetContentId: resolved.titleContentId,
      targetKind: resolved.title.mediaType,
      rating: null,
      ratedAt: null,
      removedAt: params.occurredAt,
      lastMutationSeq,
      sourceKind: params.sourceKind ?? 'local',
      sourceProvider: params.sourceProvider ?? null,
      sourceUpdatedAt: params.occurredAt,
    });

    await this.refreshProjection(client, params.profileId, resolved, projection);
  }

  async dismissContinueWatching(client: DbClient, params: {
    profileId: string;
    identity: MediaIdentity;
    occurredAt: string;
    sourceKind?: WatchV2SourceKind;
    sourceProvider?: ProviderImportProvider | null;
  }): Promise<void> {
    const resolved = await this.resolveTarget(client, params.identity);
    const projection = await this.buildProjection(client, params.identity);
    if (!isPlayableTarget(resolved.mediaType)) {
      await this.refreshProjection(client, params.profileId, resolved, projection);
      return;
    }

    const lastMutationSeq = await this.repository.reserveMutationSequence(client, params.profileId);
    await this.repository.dismissPlayableState(client, {
      profileId: params.profileId,
      contentId: resolved.contentId,
      lastMutationSeq,
      sourceKind: params.sourceKind ?? 'local',
      sourceProvider: params.sourceProvider ?? null,
      sourceUpdatedAt: params.occurredAt,
    });

    await this.refreshProjection(client, params.profileId, resolved, projection);
  }

  private async resolveTarget(client: DbClient, identity: MediaIdentity): Promise<WatchV2ResolvedTarget> {
    if (identity.mediaType === 'season') {
      const title = await this.resolveTitleIdentity(client, identity);
      return {
        contentId: title.contentId,
        titleContentId: title.contentId,
        mediaKey: title.mediaKey,
        mediaType: title.mediaType,
        provider: title.provider,
        providerId: title.providerId,
        parentProvider: null,
        parentProviderId: null,
        seasonNumber: identity.seasonNumber,
        episodeNumber: null,
        absoluteEpisodeNumber: null,
        releaseAt: null,
        title,
      };
    }

    const contentId = await this.contentIdentityService.ensureContentId(client, identity);
    if (identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime') {
      const normalized = inferMediaIdentity({
        ...identity,
        contentId,
        mediaType: identity.mediaType,
        provider: identity.provider,
        providerId: identity.providerId,
      });
      return {
        contentId,
        titleContentId: contentId,
        mediaKey: normalized.mediaKey,
        mediaType: identity.mediaType,
        provider: normalized.provider ?? titleProviderForIdentity(normalized),
        providerId: normalized.providerId ?? normalized.mediaKey,
        parentProvider: null,
        parentProviderId: null,
        seasonNumber: normalized.seasonNumber,
        episodeNumber: normalized.episodeNumber,
        absoluteEpisodeNumber: normalized.absoluteEpisodeNumber ?? null,
        releaseAt: null,
        title: {
          contentId,
          mediaKey: normalized.mediaKey,
          mediaType: identity.mediaType,
          provider: normalized.provider ?? titleProviderForIdentity(normalized),
          providerId: normalized.providerId ?? normalized.mediaKey,
        },
      };
    }

    const title = await this.resolveTitleIdentity(client, identity);
    const normalized = inferMediaIdentity({
      ...identity,
      contentId,
      parentContentId: title.contentId,
      parentProvider: title.provider,
      parentProviderId: title.providerId,
    });
    return {
      contentId,
      titleContentId: title.contentId,
      mediaKey: normalized.mediaKey,
      mediaType: 'episode',
      provider: normalized.provider ?? title.provider,
      providerId: normalized.providerId ?? normalized.mediaKey,
      parentProvider: normalized.parentProvider ?? title.provider,
      parentProviderId: normalized.parentProviderId ?? title.providerId,
      seasonNumber: normalized.seasonNumber,
      episodeNumber: normalized.episodeNumber,
      absoluteEpisodeNumber: normalized.absoluteEpisodeNumber ?? null,
      releaseAt: null,
      title,
    };
  }

  private async resolveTitleIdentity(client: DbClient, identity: MediaIdentity): Promise<WatchV2TitleIdentity> {
    const titleMediaType = parentMediaTypeForIdentity(identity) as WatchV2TitleKind;
    const titleProvider = identity.parentProvider ?? identity.provider ?? titleProviderForIdentity(identity);
    const titleProviderId = identity.parentProviderId ?? identity.providerId ?? identity.mediaKey;
    const titleTmdbId = titleMediaType === 'show' ? showTmdbIdForIdentity(identity) : null;
    const titleIdentity = inferMediaIdentity({
      contentId: identity.parentContentId,
      mediaType: titleMediaType,
      provider: titleProvider,
      providerId: titleProviderId,
      providerMetadata: titleTmdbId ? { tmdbId: titleTmdbId, showTmdbId: titleTmdbId } : undefined,
    });
    const titleContentId = await this.contentIdentityService.ensureContentId(client, titleIdentity);
    return {
      contentId: titleContentId,
      mediaKey: titleIdentity.mediaKey,
      mediaType: titleMediaType,
      provider: titleIdentity.provider ?? titleProvider,
      providerId: titleIdentity.providerId ?? titleProviderId,
    };
  }

  private async buildProjection(client: DbClient, identity: MediaIdentity): Promise<WatchMediaProjection> {
    return this.metadataService.buildProjection(client, identity);
  }

  private async refreshProjection(
    client: DbClient,
    profileId: string,
    resolved: WatchV2ResolvedTarget,
    projection: WatchMediaProjection,
  ): Promise<void> {
    const aggregate = await this.repository.getProjectionAggregate(client, profileId, resolved.titleContentId);
    const activeIdentity = aggregate.activeState
      ? await this.resolvePlayableIdentity(client, aggregate.activeState.contentId).catch(() => null)
      : null;
    const activeProjection = activeIdentity
      ? await this.buildProjection(client, activeIdentity)
      : null;
    const effectiveWatched = computeEffectiveWatched(aggregate);
    const lastCompletedAt = maxIsoStrings(
      aggregate.lastPlayableCompletedAt,
      aggregate.lastHistoryCompletedAt,
      aggregate.override?.overrideState === 'watched' ? aggregate.override.sourceUpdatedAt : null,
    );
    const keepProjection = Boolean(
      aggregate.activeState
      || aggregate.watchlist?.present
      || aggregate.rating?.rating !== null
      || effectiveWatched
      || aggregate.override?.overrideState === 'unwatched',
    );

    if (!keepProjection) {
      await this.repository.deleteTitleProjection(client, profileId, resolved.titleContentId);
      await this.metadataService.deleteEpisodicFollowState(client, profileId, resolved.titleContentId);
      return;
    }

    await this.metadataService.syncEpisodicFollowState(client, {
      profileId,
      titleContentId: resolved.titleContentId,
      titleMediaKey: resolved.title.mediaKey,
      seriesIdentity:
        resolved.title.mediaType === 'show' || resolved.title.mediaType === 'anime'
          ? inferMediaIdentity({
              mediaKey: resolved.title.mediaKey,
              mediaType: resolved.title.mediaType,
              provider: resolved.title.provider,
              providerId: resolved.title.providerId,
              contentId: resolved.title.contentId,
            })
          : null,
    });

    await this.repository.upsertTitleProjection(client, {
      profileId,
      titleContentId: resolved.titleContentId,
      titleKind: resolved.title.mediaType,
      titleIdentity: resolved.title,
      titleProjection: projection,
      activeIdentity,
      activeProjection,
      aggregate: {
        ...aggregate,
        lastPlayableCompletedAt: aggregate.lastPlayableCompletedAt,
        lastHistoryCompletedAt: aggregate.lastHistoryCompletedAt,
      },
    });
  }

  private async resolvePlayableIdentity(client: DbClient, contentId: string): Promise<MediaIdentity> {
    const reference = await this.contentIdentityService.resolveContentReference(client, contentId);
    if ('mediaIdentity' in reference) {
      return reference.mediaIdentity;
    }
    throw new Error(`Unsupported playable content id ${contentId}`);
  }
}

export class WatchV2WriteRepository {
  async reserveMutationSequence(client: DbClient, profileId: string): Promise<number> {
    const result = await client.query(
      `
        INSERT INTO profile_watch_clock (profile_id, next_mutation_seq, updated_at)
        VALUES ($1::uuid, 2, now())
        ON CONFLICT (profile_id)
        DO UPDATE SET
          next_mutation_seq = profile_watch_clock.next_mutation_seq + 1,
          updated_at = now()
        RETURNING next_mutation_seq - 1 AS mutation_seq
      `,
      [profileId],
    );

    return Number(result.rows[0]?.mutation_seq ?? 1);
  }

  async getPlayableState(client: DbClient, profileId: string, contentId: string): Promise<PlayableStateSnapshot | null> {
    const result = await client.query(
      `
        SELECT
          content_id,
          playback_status,
          position_seconds,
          duration_seconds,
          progress_percent,
          play_count,
          last_completed_at,
          last_activity_at,
          dismissed_at
        FROM profile_playable_state
        WHERE profile_id = $1::uuid AND content_id = $2::uuid
      `,
      [profileId, contentId],
    );

    return toPlayableState(result.rows[0]);
  }

  async upsertPlayableState(client: DbClient, params: UpsertPlayableStateParams): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_playable_state (
          profile_id,
          content_id,
          title_content_id,
          playback_status,
          position_seconds,
          duration_seconds,
          progress_percent,
          play_count,
          first_completed_at,
          last_completed_at,
          last_activity_at,
          dismissed_at,
          last_mutation_seq,
          source_kind,
          source_provider,
          source_updated_at,
          updated_at
        )
        VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8,
          $9::timestamptz, $10::timestamptz, $11::timestamptz, $12::timestamptz,
          $13, $14, $15, $16::timestamptz, now()
        )
        ON CONFLICT (profile_id, content_id)
        DO UPDATE SET
          title_content_id = EXCLUDED.title_content_id,
          playback_status = EXCLUDED.playback_status,
          position_seconds = EXCLUDED.position_seconds,
          duration_seconds = EXCLUDED.duration_seconds,
          progress_percent = EXCLUDED.progress_percent,
          play_count = GREATEST(profile_playable_state.play_count, EXCLUDED.play_count),
          first_completed_at = COALESCE(profile_playable_state.first_completed_at, EXCLUDED.first_completed_at),
          last_completed_at = EXCLUDED.last_completed_at,
          last_activity_at = EXCLUDED.last_activity_at,
          dismissed_at = EXCLUDED.dismissed_at,
          last_mutation_seq = EXCLUDED.last_mutation_seq,
          source_kind = EXCLUDED.source_kind,
          source_provider = EXCLUDED.source_provider,
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = now()
      `,
      [
        params.profileId,
        params.contentId,
        params.titleContentId,
        params.playbackStatus,
        params.positionSeconds,
        params.durationSeconds,
        params.progressPercent,
        params.playCount,
        params.firstCompletedAt,
        params.lastCompletedAt,
        params.lastActivityAt,
        params.dismissedAt,
        params.lastMutationSeq,
        params.sourceKind,
        params.sourceProvider,
        params.sourceUpdatedAt,
      ],
    );
  }

  async dismissPlayableState(client: DbClient, params: {
    profileId: string;
    contentId: string;
    lastMutationSeq: number;
    sourceKind: WatchV2SourceKind;
    sourceProvider: ProviderImportProvider | null;
    sourceUpdatedAt: string;
  }): Promise<void> {
    await client.query(
      `
        UPDATE profile_playable_state
        SET
          playback_status = 'dismissed',
          dismissed_at = $3::timestamptz,
          last_mutation_seq = $4,
          source_kind = $5,
          source_provider = $6,
          source_updated_at = $3::timestamptz,
          updated_at = now()
        WHERE profile_id = $1::uuid AND content_id = $2::uuid
      `,
      [params.profileId, params.contentId, params.sourceUpdatedAt, params.lastMutationSeq, params.sourceKind, params.sourceProvider],
    );
  }

  async upsertWatchOverride(client: DbClient, params: UpsertOverrideParams): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_watch_override (
          profile_id,
          target_content_id,
          target_kind,
          override_state,
          scope,
          applies_through_release_at,
          last_mutation_seq,
          source_kind,
          source_provider,
          source_updated_at,
          updated_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10::timestamptz, now())
        ON CONFLICT (profile_id, target_content_id)
        DO UPDATE SET
          target_kind = EXCLUDED.target_kind,
          override_state = EXCLUDED.override_state,
          scope = EXCLUDED.scope,
          applies_through_release_at = EXCLUDED.applies_through_release_at,
          last_mutation_seq = EXCLUDED.last_mutation_seq,
          source_kind = EXCLUDED.source_kind,
          source_provider = EXCLUDED.source_provider,
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = now()
      `,
      [
        params.profileId,
        params.targetContentId,
        params.targetKind,
        params.overrideState,
        params.scope,
        params.appliesThroughReleaseAt,
        params.lastMutationSeq,
        params.sourceKind,
        params.sourceProvider,
        params.sourceUpdatedAt,
      ],
    );
  }

  async upsertWatchlistState(client: DbClient, params: UpsertWatchlistParams): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_watchlist_state (
          profile_id,
          target_content_id,
          target_kind,
          present,
          added_at,
          removed_at,
          last_mutation_seq,
          source_kind,
          source_provider,
          source_updated_at,
          updated_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9, $10::timestamptz, now())
        ON CONFLICT (profile_id, target_content_id)
        DO UPDATE SET
          target_kind = EXCLUDED.target_kind,
          present = EXCLUDED.present,
          added_at = EXCLUDED.added_at,
          removed_at = EXCLUDED.removed_at,
          last_mutation_seq = EXCLUDED.last_mutation_seq,
          source_kind = EXCLUDED.source_kind,
          source_provider = EXCLUDED.source_provider,
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = now()
      `,
      [
        params.profileId,
        params.targetContentId,
        params.targetKind,
        params.present,
        params.addedAt,
        params.removedAt,
        params.lastMutationSeq,
        params.sourceKind,
        params.sourceProvider,
        params.sourceUpdatedAt,
      ],
    );
  }

  async upsertRatingState(client: DbClient, params: UpsertRatingParams): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_rating_state (
          profile_id,
          target_content_id,
          target_kind,
          rating,
          rated_at,
          removed_at,
          last_mutation_seq,
          source_kind,
          source_provider,
          source_updated_at,
          updated_at
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9, $10::timestamptz, now())
        ON CONFLICT (profile_id, target_content_id)
        DO UPDATE SET
          target_kind = EXCLUDED.target_kind,
          rating = EXCLUDED.rating,
          rated_at = EXCLUDED.rated_at,
          removed_at = EXCLUDED.removed_at,
          last_mutation_seq = EXCLUDED.last_mutation_seq,
          source_kind = EXCLUDED.source_kind,
          source_provider = EXCLUDED.source_provider,
          source_updated_at = EXCLUDED.source_updated_at,
          updated_at = now()
      `,
      [
        params.profileId,
        params.targetContentId,
        params.targetKind,
        params.rating,
        params.ratedAt,
        params.removedAt,
        params.lastMutationSeq,
        params.sourceKind,
        params.sourceProvider,
        params.sourceUpdatedAt,
      ],
    );
  }

  async insertPlayHistory(client: DbClient, params: {
    profileId: string;
    contentId: string;
    titleContentId: string;
    completedAt: string;
    lastMutationSeq: number;
    sourceKind: WatchV2SourceKind;
    sourceProvider: ProviderImportProvider | null;
  }): Promise<void> {
    await client.query(
      `
        INSERT INTO profile_play_history (
          profile_id,
          content_id,
          title_content_id,
          completed_at,
          last_mutation_seq,
          source_kind,
          source_provider
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5, $6, $7)
      `,
      [params.profileId, params.contentId, params.titleContentId, params.completedAt, params.lastMutationSeq, params.sourceKind, params.sourceProvider],
    );
  }

  async deletePlayableState(client: DbClient, profileId: string, contentId: string): Promise<void> {
    await client.query(
      'DELETE FROM profile_playable_state WHERE profile_id = $1::uuid AND content_id = $2::uuid',
      [profileId, contentId],
    );
  }

  async deletePlayableStateByTitle(client: DbClient, profileId: string, titleContentId: string): Promise<void> {
    await client.query(
      'DELETE FROM profile_playable_state WHERE profile_id = $1::uuid AND title_content_id = $2::uuid',
      [profileId, titleContentId],
    );
  }

  async voidPlayHistory(client: DbClient, profileId: string, contentId: string, voidedAt: string): Promise<void> {
    await client.query(
      `
        UPDATE profile_play_history
        SET voided_at = $3::timestamptz
        WHERE profile_id = $1::uuid AND content_id = $2::uuid AND voided_at IS NULL
      `,
      [profileId, contentId, voidedAt],
    );
  }

  async voidPlayHistoryByTitle(client: DbClient, profileId: string, titleContentId: string, voidedAt: string): Promise<void> {
    await client.query(
      `
        UPDATE profile_play_history
        SET voided_at = $3::timestamptz
        WHERE profile_id = $1::uuid AND title_content_id = $2::uuid AND voided_at IS NULL
      `,
      [profileId, titleContentId, voidedAt],
    );
  }

  async getProjectionAggregate(client: DbClient, profileId: string, titleContentId: string): Promise<ProjectionAggregate> {
    const result = await client.query(
      `
        WITH active_state AS (
          SELECT
            content_id,
            playback_status,
            position_seconds,
            duration_seconds,
            progress_percent,
            play_count,
            last_completed_at,
            last_activity_at,
            dismissed_at
          FROM profile_playable_state
          WHERE profile_id = $1::uuid AND title_content_id = $2::uuid
          ORDER BY
            CASE playback_status
              WHEN 'in_progress' THEN 0
              WHEN 'completed' THEN 1
              WHEN 'dismissed' THEN 2
              ELSE 3
            END,
            last_activity_at DESC,
            updated_at DESC
          LIMIT 1
        ),
        title_override AS (
          SELECT override_state, source_updated_at
          FROM profile_watch_override
          WHERE profile_id = $1::uuid AND target_content_id = $2::uuid
          LIMIT 1
        ),
        watchlist_state AS (
          SELECT present, COALESCE(added_at, removed_at, updated_at) AS changed_at
          FROM profile_watchlist_state
          WHERE profile_id = $1::uuid AND target_content_id = $2::uuid
          LIMIT 1
        ),
        rating_state AS (
          SELECT rating, COALESCE(rated_at, removed_at, updated_at) AS changed_at
          FROM profile_rating_state
          WHERE profile_id = $1::uuid AND target_content_id = $2::uuid
          LIMIT 1
        ),
        playable_completion AS (
          SELECT MAX(last_completed_at) AS completed_at
          FROM profile_playable_state
          WHERE profile_id = $1::uuid AND title_content_id = $2::uuid AND last_completed_at IS NOT NULL
        ),
        history_completion AS (
          SELECT MAX(completed_at) AS completed_at
          FROM profile_play_history
          WHERE profile_id = $1::uuid AND title_content_id = $2::uuid AND voided_at IS NULL
        )
        SELECT
          a.content_id AS active_content_id,
          a.playback_status AS active_playback_status,
          a.position_seconds AS active_position_seconds,
          a.duration_seconds AS active_duration_seconds,
          a.progress_percent AS active_progress_percent,
          a.play_count AS active_play_count,
          a.last_completed_at AS active_last_completed_at,
          a.last_activity_at AS active_last_activity_at,
          a.dismissed_at AS active_dismissed_at,
          o.override_state,
          o.source_updated_at AS override_source_updated_at,
          w.present AS watchlist_present,
          w.changed_at AS watchlist_changed_at,
          r.rating AS rating_value,
          r.changed_at AS rating_changed_at,
          pc.completed_at AS last_playable_completed_at,
          hc.completed_at AS last_history_completed_at
        FROM (SELECT 1) seed
        LEFT JOIN active_state a ON true
        LEFT JOIN title_override o ON true
        LEFT JOIN watchlist_state w ON true
        LEFT JOIN rating_state r ON true
        LEFT JOIN playable_completion pc ON true
        LEFT JOIN history_completion hc ON true
      `,
      [profileId, titleContentId],
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;
    const activeState = row?.active_content_id
      ? toPlayableState({
          content_id: row.active_content_id,
          playback_status: row.active_playback_status,
          position_seconds: row.active_position_seconds,
          duration_seconds: row.active_duration_seconds,
          progress_percent: row.active_progress_percent,
          play_count: row.active_play_count,
          last_completed_at: row.active_last_completed_at,
          last_activity_at: row.active_last_activity_at,
          dismissed_at: row.active_dismissed_at,
        })
      : null;
    const override = row?.override_state
      ? {
          overrideState: (row.override_state === 'watched' ? 'watched' : 'unwatched') as 'watched' | 'unwatched',
          sourceUpdatedAt: normalizeIsoString(row.override_source_updated_at as Date | string | null | undefined) ?? new Date(0).toISOString(),
        }
      : null;
    const watchlist = row?.watchlist_present === undefined
      ? null
      : {
          present: Boolean(row.watchlist_present),
          changedAt: normalizeIsoString(row.watchlist_changed_at as Date | string | null | undefined),
        };
    const rating = row?.rating_value === undefined && row?.rating_changed_at === undefined
      ? null
      : {
          rating: row?.rating_value === null ? null : Number(row?.rating_value),
          changedAt: normalizeIsoString(row?.rating_changed_at as Date | string | null | undefined),
        };
    const lastPlayableCompletedAt = normalizeIsoString(row?.last_playable_completed_at as Date | string | null | undefined);
    const lastHistoryCompletedAt = normalizeIsoString(row?.last_history_completed_at as Date | string | null | undefined);

    return {
      activeState,
      override,
      watchlist,
      rating,
      lastPlayableCompletedAt,
      lastHistoryCompletedAt,
    };
  }

  async upsertTitleProjection(client: DbClient, params: ProjectionUpsertParams): Promise<void> {
    const effectiveWatched = computeEffectiveWatched(params.aggregate);
    const lastCompletedAt = maxIsoStrings(
      params.aggregate.lastPlayableCompletedAt,
      params.aggregate.lastHistoryCompletedAt,
      params.aggregate.override?.overrideState === 'watched' ? params.aggregate.override.sourceUpdatedAt : null,
    );
    const activeIdentity = params.activeIdentity;
    const activeProjection = params.activeProjection;

    await client.query(
      `
        INSERT INTO profile_title_projection (
          profile_id,
          title_content_id,
          title_kind,
          title_media_key,
          title_media_type,
          title_provider,
          title_provider_id,
          title_content_release_at,
          title_release_year,
          title_runtime_minutes,
          title_rating,
          title_text,
          title_subtitle,
          title_poster_url,
          title_backdrop_url,
          active_content_id,
          active_media_key,
          active_media_type,
          active_provider,
          active_provider_id,
          active_parent_provider,
          active_parent_provider_id,
          active_season_number,
          active_episode_number,
          active_episode_title,
          active_episode_release_at,
          active_position_seconds,
          active_duration_seconds,
          active_progress_percent,
          has_in_progress,
          effective_watched,
          last_completed_at,
          last_watched_at,
          watchlist_present,
          watchlist_updated_at,
          rating_value,
          rated_at,
          dismissed_at,
          last_activity_at,
          updated_at
        )
        VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11,
          $12, $13, $14, $15,
          $16::uuid, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26::timestamptz,
          $27, $28, $29, $30, $31, $32::timestamptz, $33::timestamptz, $34, $35::timestamptz,
          $36, $37::timestamptz, $38::timestamptz, $39::timestamptz, now()
        )
        ON CONFLICT (profile_id, title_content_id)
        DO UPDATE SET
          title_kind = EXCLUDED.title_kind,
          title_media_key = EXCLUDED.title_media_key,
          title_media_type = EXCLUDED.title_media_type,
          title_provider = EXCLUDED.title_provider,
          title_provider_id = EXCLUDED.title_provider_id,
          title_content_release_at = EXCLUDED.title_content_release_at,
          title_release_year = EXCLUDED.title_release_year,
          title_runtime_minutes = EXCLUDED.title_runtime_minutes,
          title_rating = EXCLUDED.title_rating,
          title_text = EXCLUDED.title_text,
          title_subtitle = EXCLUDED.title_subtitle,
          title_poster_url = EXCLUDED.title_poster_url,
          title_backdrop_url = EXCLUDED.title_backdrop_url,
          active_content_id = EXCLUDED.active_content_id,
          active_media_key = EXCLUDED.active_media_key,
          active_media_type = EXCLUDED.active_media_type,
          active_provider = EXCLUDED.active_provider,
          active_provider_id = EXCLUDED.active_provider_id,
          active_parent_provider = EXCLUDED.active_parent_provider,
          active_parent_provider_id = EXCLUDED.active_parent_provider_id,
          active_season_number = EXCLUDED.active_season_number,
          active_episode_number = EXCLUDED.active_episode_number,
          active_episode_title = EXCLUDED.active_episode_title,
          active_episode_release_at = EXCLUDED.active_episode_release_at,
          active_position_seconds = EXCLUDED.active_position_seconds,
          active_duration_seconds = EXCLUDED.active_duration_seconds,
          active_progress_percent = EXCLUDED.active_progress_percent,
          has_in_progress = EXCLUDED.has_in_progress,
          effective_watched = EXCLUDED.effective_watched,
          last_completed_at = EXCLUDED.last_completed_at,
          last_watched_at = EXCLUDED.last_watched_at,
          watchlist_present = EXCLUDED.watchlist_present,
          watchlist_updated_at = EXCLUDED.watchlist_updated_at,
          rating_value = EXCLUDED.rating_value,
          rated_at = EXCLUDED.rated_at,
          dismissed_at = EXCLUDED.dismissed_at,
          last_activity_at = EXCLUDED.last_activity_at,
          updated_at = now()
      `,
      [
        params.profileId,
        params.titleContentId,
        params.titleKind,
        params.titleIdentity.mediaKey,
        params.titleIdentity.mediaType,
        params.titleIdentity.provider,
        params.titleIdentity.providerId,
        null,
        params.titleProjection.detailsReleaseYear,
        params.titleProjection.detailsRuntimeMinutes,
        params.titleProjection.detailsRating,
        params.titleProjection.title,
        params.titleProjection.subtitle,
        params.titleProjection.posterUrl,
        params.titleProjection.backdropUrl,
        activeIdentity?.contentId ?? null,
        activeIdentity?.mediaKey ?? null,
        activeIdentity?.mediaType === 'movie' || activeIdentity?.mediaType === 'episode' ? activeIdentity.mediaType : null,
        activeIdentity?.provider ?? null,
        activeIdentity?.providerId ?? null,
        activeIdentity?.parentProvider ?? null,
        activeIdentity?.parentProviderId ?? null,
        activeIdentity?.seasonNumber ?? null,
        activeIdentity?.episodeNumber ?? null,
        activeProjection?.episodeTitle ?? null,
        activeProjection?.episodeAirDate ?? null,
        params.aggregate.activeState?.positionSeconds ?? null,
        params.aggregate.activeState?.durationSeconds ?? null,
        params.aggregate.activeState?.progressPercent ?? null,
        params.aggregate.activeState?.playbackStatus === 'in_progress',
        effectiveWatched,
        lastCompletedAt,
        lastCompletedAt,
        params.aggregate.watchlist?.present ?? false,
        params.aggregate.watchlist?.changedAt ?? null,
        params.aggregate.rating?.rating ?? null,
        params.aggregate.rating?.changedAt ?? null,
        params.aggregate.activeState?.dismissedAt ?? null,
        params.aggregate.activeState?.lastActivityAt ?? lastCompletedAt,
      ],
    );
  }

  async deleteTitleProjection(client: DbClient, profileId: string, titleContentId: string): Promise<void> {
    await client.query(
      'DELETE FROM profile_title_projection WHERE profile_id = $1::uuid AND title_content_id = $2::uuid',
      [profileId, titleContentId],
    );
  }

}

function toPlayableState(row: Record<string, unknown> | undefined): PlayableStateSnapshot | null {
  if (!row) {
    return null;
  }

  return {
    contentId: String(row.content_id),
    playbackStatus: toPlayableStatus(row.playback_status),
    positionSeconds: Number(row.position_seconds ?? 0),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    progressPercent: Number(row.progress_percent ?? 0),
    playCount: Number(row.play_count ?? 0),
    lastCompletedAt: normalizeIsoString(row.last_completed_at as Date | string | null | undefined),
    lastActivityAt: normalizeIsoString(row.last_activity_at as Date | string | null | undefined) ?? new Date(0).toISOString(),
    dismissedAt: normalizeIsoString(row.dismissed_at as Date | string | null | undefined),
  };
}

function toPlayableStatus(value: unknown): WatchV2PlayableStatus {
  return value === 'completed' || value === 'dismissed' || value === 'idle' ? value : 'in_progress';
}

function computeEffectiveWatched(aggregate: ProjectionAggregate): boolean {
  if (aggregate.override?.overrideState === 'watched') {
    return true;
  }
  if (aggregate.override?.overrideState === 'unwatched') {
    return false;
  }

  return Boolean(aggregate.lastPlayableCompletedAt || aggregate.lastHistoryCompletedAt || aggregate.activeState?.playbackStatus === 'completed');
}

function fallbackProjection(identity: MediaIdentity): WatchMediaProjection {
  const titleMediaType = identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime'
    ? identity.mediaType
    : parentMediaTypeForIdentity(identity);

  return {
    detailsTitleMediaType: titleMediaType,
    playbackMediaType: identity.mediaType === 'movie' || identity.mediaType === 'show' || identity.mediaType === 'anime' || identity.mediaType === 'episode'
      ? identity.mediaType
      : null,
    playbackProvider: identity.provider ?? null,
    playbackProviderId: identity.providerId ?? null,
    playbackParentProvider: identity.parentProvider ?? null,
    playbackParentProviderId: identity.parentProviderId ?? null,
    playbackSeasonNumber: identity.seasonNumber,
    playbackEpisodeNumber: identity.episodeNumber,
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

function maxIsoStrings(...values: Array<string | null | undefined>): string | null {
  const normalized = values.flatMap((value) => {
    const iso = normalizeIsoString(value ?? null);
    return iso ? [iso] : [];
  });

  if (!normalized.length) {
    return null;
  }

  return normalized.reduce((latest, candidate) => (candidate > latest ? candidate : latest));
}

function isPlayableTarget(mediaType: WatchV2TargetKind): mediaType is Extract<WatchV2TargetKind, 'movie' | 'episode'> {
  return mediaType === 'movie' || mediaType === 'episode';
}

function isTitleTarget(mediaType: WatchV2TargetKind): mediaType is WatchV2TitleKind {
  return mediaType === 'movie' || mediaType === 'show' || mediaType === 'anime';
}

function titleProviderForIdentity(identity: MediaIdentity) {
  return parentMediaTypeForIdentity(identity) === 'anime' ? 'kitsu' : identity.provider ?? identity.parentProvider ?? 'tvdb';
}
