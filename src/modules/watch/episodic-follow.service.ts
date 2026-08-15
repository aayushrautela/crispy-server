import type { DbClient } from '../../lib/db.js';
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
    const candidates = await this.loadCandidates(client, profileId, Math.max(limit * 4, 50));
    if (!candidates.length) {
      return [];
    }

    const showItemIds = candidates.map((candidate) => candidate.showItemId);
    const providerRefsByItem = await this.contentIdentityService.resolveProviderRefsForItemIds(client, showItemIds);

    const identitiesByItem = new Map<string, MediaIdentity>();
    const resolvedIdentities: MediaIdentity[] = [];
    for (const showItemId of showItemIds) {
      const tmdbRef = (providerRefsByItem.get(showItemId) ?? []).find((ref) => ref.provider === 'tmdb');
      if (!tmdbRef) {
        continue;
      }
      const identity = this.buildShowIdentity(showItemId, tmdbRef.externalId);
      identitiesByItem.set(showItemId, identity);
      resolvedIdentities.push(identity);
    }

    if (!resolvedIdentities.length) {
      return [];
    }

    const cards = await this.metadataCardService.buildCardViews(client, resolvedIdentities);
    const nextEpisodes = await this.metadataProjectionService.resolveNextEpisodes(client, resolvedIdentities);
    const cardByKey = new Map(resolvedIdentities.map((identity, index) => [identity.mediaKey, cards[index]]));

    const items: EpisodicFollowView[] = [];
    for (const candidate of candidates) {
      if (items.length >= limit) {
        break;
      }

      const identity = identitiesByItem.get(candidate.showItemId);
      if (!identity) {
        continue;
      }

      const show = cardByKey.get(identity.mediaKey);
      if (!show) {
        continue;
      }

      const nextEpisode = nextEpisodes.get(identity.mediaKey) ?? null;
      items.push({
        show,
        reason: candidate.reason,
        lastInteractedAt: candidate.lastInteractedAt,
        nextEpisodeAirDate: nextEpisode?.airDate ?? null,
        nextEpisodeItemId: nextEpisode?.itemId ?? null,
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

  private buildShowIdentity(showItemId: string, tmdbExternalId: string): MediaIdentity {
    return {
      mediaKey: `show:tmdb:${tmdbExternalId}`,
      mediaType: 'show',
      provider: 'tmdb',
      providerId: tmdbExternalId,
      tmdbId: Number(tmdbExternalId),
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
      absoluteEpisodeNumber: null,
      contentId: showItemId,
      parentContentId: null,
      parentProvider: null,
      parentProviderId: null,
    } satisfies MediaIdentity;
  }

  private async loadCandidates(client: DbClient, profileId: string, limit: number): Promise<Candidate[]> {
    const [continueWatching, history, watchlist] = await Promise.all([
      this.queryContinueWatching(client, profileId, limit),
      this.queryHistory(client, profileId, limit),
      this.queryWatchlist(client, profileId, limit),
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

  private async queryContinueWatching(client: DbClient, profileId: string, limit: number): Promise<Array<{ title_item_id: string; playable_item_id: string; last_activity_at: string }>> {
    const result = await client.query(
      `SELECT title_item_id, playable_item_id, last_activity_at
       FROM user_state.playback_progress
       WHERE profile_id = $1::uuid AND dismissed_at IS NULL
       ORDER BY last_activity_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryHistory(client: DbClient, profileId: string, limit: number): Promise<Array<{ title_item_id: string; occurred_at: string }>> {
    const result = await client.query(
      `SELECT title_item_id, occurred_at
       FROM user_state.watch_events
       WHERE profile_id = $1::uuid AND media_type = 'episode' AND event_type = 'playback_completed'
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryWatchlist(client: DbClient, profileId: string, limit: number): Promise<Array<{ item_id: string; added_at: string }>> {
    const result = await client.query(
      `SELECT item_id, added_at
       FROM user_state.profile_list_items
       WHERE profile_id = $1::uuid AND list_kind = 'watchlist' AND media_type IN ('show', 'episode')
       ORDER BY added_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }
}
