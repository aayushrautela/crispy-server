import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';

export class WatchV2EpisodeHistoryService {
  async getEpisodeWatchedAt(
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
}

function requireOptionalIsoString(value: Date | string | null | undefined): string | null {
  return value ? requireDbIsoString(value, 'watch_v2_episode_history.timestamp') : null;
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
