import { withDbClient, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { requireDbIsoString } from '../../lib/time.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { type MediaIdentity, parseMediaKey } from '../identity/media-key.js';
import { MetadataTitleSourceService } from '../metadata/metadata-title-source.service.js';
import type { WatchStateLookupInput, WatchStateResponse } from './watch-read.types.js';
import { encodeWatchV2ContinueWatchingId, resolveWatchV2Lookup } from './watch-v2-utils.js';
import { listWatchV2WatchedEpisodeKeys } from './watch-v2-episode-keys.js';

export class WatchStateService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly metadataCardService = new MetadataCardService(),
    private readonly contentIdentityService = new ContentIdentityService(),
    private readonly metadataTitleSourceService = new MetadataTitleSourceService(),
  ) {}

  async getState(userId: string, profileId: string, input: WatchStateLookupInput): Promise<WatchStateResponse> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const identity = resolveIdentity(input);
      const media = await this.metadataCardService.buildCardView(client, identity);
      const lookup = await resolveWatchV2Lookup(client, this.contentIdentityService, identity);
      const [projection, progress, episodeWatchedAt, watchedEpisodeKeys, watchlistState, ratingState] = await Promise.all([
        this.getTitleProjection(client, profileId, lookup.titleContentId),
        this.getPlayableProgress(client, profileId, lookup.contentId, identity.mediaType),
        identity.mediaType === 'episode'
          ? this.getEpisodeWatchedAt(client, profileId, lookup.contentId, lookup.titleContentId, media.releaseDate)
          : Promise.resolve(null),
        this.listWatchedEpisodeKeys(client, profileId, identity, lookup.titleContentId),
        this.getWatchlistState(client, profileId, lookup.titleContentId),
        this.getRatingState(client, profileId, lookup.titleContentId),
      ]);

      return {
        media: {
          mediaType: media.mediaType,
          mediaKey: media.mediaKey,
          provider: media.provider,
          providerId: media.providerId,
          title: media.title ?? 'Unknown title',
          posterUrl: media.images.posterUrl ?? media.artwork.posterUrl ?? '',
          releaseYear: media.releaseYear,
          rating: media.rating,
          genre: null,
          subtitle: media.subtitle,
        },
        progress,
        continueWatching: projection && projection.has_in_progress === true && projection.dismissed_at === null
          ? {
              id: encodeWatchV2ContinueWatchingId(String(projection.title_content_id)),
              positionSeconds: projection.active_position_seconds === null ? null : Number(projection.active_position_seconds),
              durationSeconds: projection.active_duration_seconds === null ? null : Number(projection.active_duration_seconds),
              progressPercent: Number(projection.active_progress_percent ?? 0),
              lastActivityAt: requireDbIsoString(projection.last_activity_at as Date | string | null | undefined, 'profile_title_projection.last_activity_at'),
            }
          : null,
        watched: identity.mediaType === 'episode'
          ? (episodeWatchedAt ? { watchedAt: episodeWatchedAt } : null)
          : projection && projection.effective_watched === true && projection.last_watched_at
            ? {
                watchedAt: requireDbIsoString(projection.last_watched_at as Date | string | null | undefined, 'profile_title_projection.last_watched_at'),
              }
            : null,
        watchlist: watchlistState && watchlistState.present === true && watchlistState.addedAt
          ? {
              addedAt: watchlistState.addedAt,
            }
          : null,
        rating: ratingState && ratingState.value !== null && ratingState.ratedAt
          ? {
              value: ratingState.value,
              ratedAt: ratingState.ratedAt,
            }
          : null,
        watchedEpisodeKeys,
      };
    });
  }

  async getStates(userId: string, profileId: string, inputs: WatchStateLookupInput[]): Promise<WatchStateResponse[]> {
    if (inputs.length === 0) {
      return [];
    }

    return Promise.all(inputs.map((input) => this.getState(userId, profileId, input)));
  }

  private async getTitleProjection(client: DbClient, profileId: string, titleContentId: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      'SELECT * FROM profile_title_projection WHERE profile_id = $1::uuid AND title_content_id = $2::uuid',
      [profileId, titleContentId],
    );
    return result.rows[0] ?? null;
  }

  private async getPlayableProgress(client: DbClient, profileId: string, contentId: string, mediaType: MediaIdentity['mediaType']) {
    if (mediaType !== 'movie' && mediaType !== 'episode') {
      return null;
    }

    const result = await client.query(
      `
        SELECT position_seconds, duration_seconds, progress_percent, playback_status, last_activity_at
        FROM profile_playable_state
        WHERE profile_id = $1::uuid AND content_id = $2::uuid
      `,
      [profileId, contentId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      progressPercent: Number(row.progress_percent ?? 0),
      status: String(row.playback_status),
      lastPlayedAt: requireDbIsoString(row.last_activity_at as Date | string | null | undefined, 'profile_playable_state.last_activity_at'),
    };
  }

  private async getWatchlistState(client: DbClient, profileId: string, titleContentId: string): Promise<{ present: boolean; addedAt: string | null } | null> {
    const result = await client.query(
      `
        SELECT present, added_at
        FROM profile_watchlist_state
        WHERE profile_id = $1::uuid AND target_content_id = $2::uuid
      `,
      [profileId, titleContentId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      present: Boolean(row.present),
      addedAt: row.added_at ? requireDbIsoString(row.added_at as Date | string | null | undefined, 'profile_watchlist_state.added_at') : null,
    };
  }

  private async getRatingState(client: DbClient, profileId: string, titleContentId: string): Promise<{ value: number | null; ratedAt: string | null } | null> {
    const result = await client.query(
      `
        SELECT rating, rated_at
        FROM profile_rating_state
        WHERE profile_id = $1::uuid AND target_content_id = $2::uuid
      `,
      [profileId, titleContentId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      value: row.rating === null ? null : Number(row.rating),
      ratedAt: row.rated_at ? requireDbIsoString(row.rated_at as Date | string | null | undefined, 'profile_rating_state.rated_at') : null,
    };
  }

  private async getEpisodeWatchedAt(
    client: DbClient,
    profileId: string,
    contentId: string,
    titleContentId: string,
    releaseDate: string | null,
  ): Promise<string | null> {
    const result = await client.query(
      `
        SELECT
          exact_override.override_state AS exact_override_state,
          exact_override.source_updated_at AS exact_override_updated_at,
          title_override.override_state AS title_override_state,
          title_override.source_updated_at AS title_override_updated_at,
          title_override.applies_through_release_at AS title_override_cutoff,
          playable.last_completed_at AS playable_completed_at,
          history.completed_at AS history_completed_at
        FROM (SELECT 1) seed
        LEFT JOIN LATERAL (
          SELECT override_state, source_updated_at
          FROM profile_watch_override
          WHERE profile_id = $1::uuid AND target_content_id = $2::uuid
          LIMIT 1
        ) exact_override ON true
        LEFT JOIN LATERAL (
          SELECT override_state, source_updated_at, applies_through_release_at
          FROM profile_watch_override
          WHERE profile_id = $1::uuid AND target_content_id = $3::uuid
          LIMIT 1
        ) title_override ON true
        LEFT JOIN LATERAL (
          SELECT last_completed_at
          FROM profile_playable_state
          WHERE profile_id = $1::uuid AND content_id = $2::uuid
          LIMIT 1
        ) playable ON true
        LEFT JOIN LATERAL (
          SELECT MAX(completed_at) AS completed_at
          FROM profile_play_history
          WHERE profile_id = $1::uuid AND content_id = $2::uuid AND voided_at IS NULL
        ) history ON true
      `,
      [profileId, contentId, titleContentId],
    );

    const row = result.rows[0] ?? null;
    if (!row) {
      return null;
    }
    if (row.exact_override_state === 'unwatched') {
      return null;
    }

    const watchedAt = [
      row.exact_override_state === 'watched'
        ? requireOptionalIsoString(row.exact_override_updated_at as Date | string | null | undefined)
        : null,
      requireOptionalIsoString(row.playable_completed_at as Date | string | null | undefined),
      requireOptionalIsoString(row.history_completed_at as Date | string | null | undefined),
      row.title_override_state === 'watched' && isReleasedByCutoff(releaseDate, requireOptionalIsoString(row.title_override_cutoff as Date | string | null | undefined))
        ? requireOptionalIsoString(row.title_override_updated_at as Date | string | null | undefined)
        : null,
    ].filter((value): value is string => value !== null);

    if (!watchedAt.length) {
      return null;
    }

    return watchedAt.reduce((latest, candidate) => candidate > latest ? candidate : latest);
  }

  private async listWatchedEpisodeKeys(
    client: DbClient,
    profileId: string,
    identity: MediaIdentity,
    titleContentId: string,
  ): Promise<string[]> {
    return listWatchV2WatchedEpisodeKeys(
      client,
      this.contentIdentityService,
      this.metadataTitleSourceService,
      profileId,
      identity,
      titleContentId,
    );
  }
}

function resolveIdentity(input: WatchStateLookupInput): MediaIdentity {
  if (input.mediaKey.trim()) {
    return parseMediaKey(input.mediaKey.trim());
  }

  throw new HttpError(400, 'mediaKey is required.');
}

function requireOptionalIsoString(value: Date | string | null | undefined): string | null {
  return value ? requireDbIsoString(value, 'watch_v2_state.timestamp') : null;
}

function isReleasedByCutoff(releaseDate: string | null, cutoff: string | null): boolean {
  if (!cutoff) {
    return true;
  }
  if (!releaseDate) {
    return false;
  }
  return releaseDate <= cutoff.slice(0, 10);
}
