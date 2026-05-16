import type { DbClient } from '../../lib/db.js';
import { db } from '../../lib/db.js';
import { parseMediaKey, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import type { EpisodicFollowView } from './watch-episodic-follow.types.js';

type Candidate = {
  showMediaKey: string;
  reason: string;
  lastInteractedAt: string;
};

export class EpisodicFollowService {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
    private readonly metadataProjectionService = new MetadataProjectionService(),
  ) {}

  async listForProfile(client: DbClient, profileId: string, limit: number): Promise<EpisodicFollowView[]> {
    const candidates = await this.loadCandidates(profileId, Math.max(limit * 4, 50));
    const items: EpisodicFollowView[] = [];

    for (const candidate of candidates) {
      if (items.length >= limit) {
        break;
      }

      const showIdentity = safeParseMediaKey(candidate.showMediaKey);
      if (!showIdentity) {
        continue;
      }

      const [show, nextEpisode] = await Promise.all([
        this.metadataCardService.buildCardView(client, showIdentity).catch(() => null),
        this.metadataProjectionService.resolveNextEpisode(client, showIdentity).catch(() => null),
      ]);
      if (!show) {
        continue;
      }

      items.push({
        show,
        reason: candidate.reason,
        lastInteractedAt: candidate.lastInteractedAt,
        nextEpisodeAirDate: nextEpisode?.airDate ?? null,
        nextEpisodeMediaKey: nextEpisode?.mediaKey ?? null,
        nextEpisodeSeasonNumber: nextEpisode?.seasonNumber ?? null,
        nextEpisodeEpisodeNumber: nextEpisode?.episodeNumber ?? null,
        nextEpisodeAbsoluteEpisodeNumber: nextEpisode?.absoluteEpisodeNumber ?? null,
        nextEpisodeTitle: nextEpisode?.title ?? null,
        metadataRefreshedAt: null,
        payload: {
          source: 'canonical_watch',
        },
      });
    }

    return items;
  }

  private async loadCandidates(profileId: string, limit: number): Promise<Candidate[]> {
    const [continueWatching, history, watchlist] = await Promise.all([
      this.queryContinueWatching(profileId, limit),
      this.queryHistory(profileId, limit),
      this.queryWatchlist(profileId, limit),
    ]);

    const candidates = new Map<string, Candidate>();
    const addCandidate = (mediaKey: unknown, lastInteractedAt: unknown, reason: string) => {
      if (typeof mediaKey !== 'string' || typeof lastInteractedAt !== 'string') {
        return;
      }
      const showMediaKey = showMediaKeyFromMediaKey(mediaKey);
      if (!showMediaKey || candidates.has(showMediaKey)) {
        return;
      }
      candidates.set(showMediaKey, {
        showMediaKey,
        reason,
        lastInteractedAt,
      });
    };

    for (const row of continueWatching) {
      addCandidate(row.title_media_key, row.last_activity_at, 'continue_watching');
      addCandidate(row.playable_media_key, row.last_activity_at, 'continue_watching');
    }
    for (const row of history) {
      addCandidate(row.media_key, row.occurred_at, 'recent_episode_history');
    }
    for (const row of watchlist) {
      addCandidate(row.media_key, row.added_at, 'watchlist');
    }

    return Array.from(candidates.values()).sort((a, b) => b.lastInteractedAt.localeCompare(a.lastInteractedAt));
  }

  private async queryContinueWatching(profileId: string, limit: number): Promise<Array<{ title_media_key: string; playable_media_key: string; last_activity_at: string }>> {
    const result = await db.query(
      `SELECT title_media_key, playable_media_key, last_activity_at
       FROM user_state.playback_progress
       WHERE profile_id = $1::uuid AND dismissed_at IS NULL
       ORDER BY last_activity_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryHistory(profileId: string, limit: number): Promise<Array<{ media_key: string; occurred_at: string }>> {
    const result = await db.query(
      `SELECT media_key, occurred_at
       FROM user_state.watch_events
       WHERE profile_id = $1::uuid AND media_type = 'episode' AND event_type = 'playback_completed'
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryWatchlist(profileId: string, limit: number): Promise<Array<{ media_key: string; added_at: string }>> {
    const result = await db.query(
      `SELECT media_key, added_at
       FROM user_state.profile_list_items
       WHERE profile_id = $1::uuid AND list_kind = 'watchlist' AND media_type IN ('show', 'episode')
       ORDER BY added_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }
}

function showMediaKeyFromMediaKey(mediaKey: string): string | null {
  const identity = safeParseMediaKey(mediaKey);
  if (!identity) {
    return null;
  }
  if (identity.mediaType === 'show') {
    return identity.mediaKey;
  }
  if (identity.mediaType !== 'episode' && identity.mediaType !== 'season') {
    return null;
  }
  const showTmdbId = showTmdbIdForIdentity(identity);
  return showTmdbId ? `show:tmdb:${showTmdbId}` : null;
}

function safeParseMediaKey(mediaKey: string): MediaIdentity | null {
  try {
    return parseMediaKey(mediaKey);
  } catch {
    return null;
  }
}
