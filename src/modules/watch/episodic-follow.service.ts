import type { DbClient } from '../../lib/db.js';
import { db } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { type MediaIdentity } from '../identity/media-key.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import type { EpisodicFollowView } from './watch-episodic-follow.types.js';

type Candidate = {
  showItemId: string;
  reason: string;
  lastInteractedAt: string;
};

export class EpisodicFollowService {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
    private readonly metadataProjectionService = new MetadataProjectionService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async listForProfile(client: DbClient, profileId: string, limit: number): Promise<EpisodicFollowView[]> {
    const candidates = await this.loadCandidates(profileId, Math.max(limit * 4, 50));
    const items: EpisodicFollowView[] = [];

    for (const candidate of candidates) {
      if (items.length >= limit) {
        break;
      }

      const showIdentity = await this.resolveShowIdentity(client, candidate.showItemId);
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
    const addCandidate = (itemId: unknown, lastInteractedAt: unknown, reason: string) => {
      if (typeof itemId !== 'string' || typeof lastInteractedAt !== 'string') {
        return;
      }
      if (!itemId || candidates.has(itemId)) {
        return;
      }
      candidates.set(itemId, {
        showItemId: itemId,
        reason,
        lastInteractedAt,
      });
    };

    for (const row of continueWatching) {
      addCandidate(row.title_item_id, row.last_activity_at, 'continue_watching');
    }
    for (const row of history) {
      addCandidate(row.title_item_id, row.occurred_at, 'recent_episode_history');
    }
    for (const row of watchlist) {
      addCandidate(row.item_id, row.added_at, 'watchlist');
    }

    return Array.from(candidates.values()).sort((a, b) => b.lastInteractedAt.localeCompare(a.lastInteractedAt));
  }

  private async queryContinueWatching(profileId: string, limit: number): Promise<Array<{ title_item_id: string; playable_item_id: string; last_activity_at: string }>> {
    const result = await db.query(
      `SELECT title_item_id, playable_item_id, last_activity_at
       FROM user_state.playback_progress
       WHERE profile_id = $1::uuid AND dismissed_at IS NULL
       ORDER BY last_activity_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryHistory(profileId: string, limit: number): Promise<Array<{ title_item_id: string; occurred_at: string }>> {
    const result = await db.query(
      `SELECT title_item_id, occurred_at
       FROM user_state.watch_events
       WHERE profile_id = $1::uuid AND media_type = 'episode' AND event_type = 'playback_completed'
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryWatchlist(profileId: string, limit: number): Promise<Array<{ item_id: string; added_at: string }>> {
    const result = await db.query(
      `SELECT item_id, added_at
       FROM user_state.profile_list_items
       WHERE profile_id = $1::uuid AND list_kind = 'watchlist' AND media_type IN ('show', 'episode')
       ORDER BY added_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async resolveShowIdentity(client: DbClient, showItemId: string): Promise<MediaIdentity | null> {
    try {
      const providerRefs = await this.contentIdentityService.resolveProviderRefsForItemId(client, showItemId);
      const tmdbRef = providerRefs.find(r => r.provider === 'tmdb');
      if (!tmdbRef) return null;
      return {
        mediaKey: `show:tmdb:${tmdbRef.externalId}`,
        mediaType: 'show',
        provider: 'tmdb',
        providerId: tmdbRef.externalId,
        tmdbId: Number(tmdbRef.externalId),
        showTmdbId: null,
        seasonNumber: null,
        episodeNumber: null,
        absoluteEpisodeNumber: null,
        contentId: showItemId,
        parentContentId: null,
        parentProvider: null,
        parentProviderId: null,
      } satisfies MediaIdentity;
    } catch {
      return null;
    }
  }
}
