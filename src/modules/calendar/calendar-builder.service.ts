import type { DbClient } from '../../lib/db.js';
import { db } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId, encodePublicItemId } from '../identity/public-item-id.js';
import { WATCHED_EVENT_TYPES, WATCH_STATE_EVENT_TYPES } from '../integrations/local-user-watch.service.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import type { MetadataCardView } from '../metadata/metadata-card.types.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';
import { metadataCardToMediaItem, mediaItemToBaseItemDto } from '../metadata/media-item.mapper.js';

const BUILD_CONCURRENCY = 4;

type Candidate = {
  showItemId: string;
  lastActivityAt: string | null;
};

export class CalendarBuilderService {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
    private readonly metadataProjectionService = new MetadataProjectionService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async build(client: DbClient, profileId: string, limit: number): Promise<BaseItemDto[]> {
    const candidates = await this.loadCandidates(profileId, Math.max(limit * 4, 50));
    const items: BaseItemDto[] = [];

    for (let i = 0; i < candidates.length && items.length < limit; i += BUILD_CONCURRENCY) {
      const batch = candidates.slice(i, i + BUILD_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async (candidate) => {
        const showIdentity = await this.contentIdentityService.resolveMediaIdentity(client, assertPublicItemId(candidate.showItemId)).catch(() => null);
        if (!showIdentity) {
          return null;
        }

        const nextEpisode = await this.metadataProjectionService.resolveNextEpisode(client, showIdentity).catch(() => null);
        const showCard = await this.metadataCardService.buildCardView(client, showIdentity).catch(() => null);
        if (!showCard || !showCard.title) {
          return null;
        }

        const episodeIdentity = nextEpisode?.itemId
          ? await this.contentIdentityService.resolveMediaIdentity(client, assertPublicItemId(nextEpisode.itemId)).catch(() => null)
          : null;
        const watched = nextEpisode?.itemId
          ? await this.isWatched(profileId, nextEpisode.itemId)
          : false;
        const mediaCard = episodeIdentity
          ? await this.metadataCardService.buildCardView(client, episodeIdentity).catch(() => null)
          : showCard;
        if (!mediaCard || !mediaCard.title) {
          return null;
        }

        const poster = mediaCard.images.poster ?? showCard.images.poster;
        const backdrop = mediaCard.images.backdrop ?? poster;

        const mediaItem = metadataCardToMediaItem(mediaCard, {
          itemId: mediaCard.itemId,
          images: {
            poster,
            backdrop,
            logo: mediaCard.images.logo,
            still: mediaCard.images.still,
          },
          airDate: nextEpisode?.airDate ?? null,
          episodeTitle: mediaCard.title,
        });

        const dto = mediaItemToBaseItemDto(mediaItem);
        dto.UserData = {
          ItemId: dto.Id,
          IsFavorite: false,
          Played: watched,
          PlayCount: watched ? 1 : 0,
          PlaybackPositionTicks: null,
          RuntimeTicks: dto.RunTimeTicks,
          PlayedPercentage: null,
          LastPlayedDate: null,
          Rating: null,
          DismissedFromContinueWatching: false,
        };

        return dto;
      }));

      for (const result of batchResults) {
        if (result && items.length < limit) {
          items.push(result);
        }
      }
    }

    return items;
  }

  private async isWatched(profileId: string, itemId: string): Promise<boolean> {
    const resolvedItemId = assertPublicItemId(itemId);
    const result = await db.query(
      `SELECT (
         (array_agg(ev.event_type ORDER BY ev.occurred_at DESC, ev.id DESC))[1] = ANY ($3::text[])
       ) AS effective_watched
       FROM user_state.watch_events ev
       WHERE ev.profile_id = $1::uuid AND ev.item_id = $2::uuid AND ev.event_type = ANY ($4::text[])`,
      [profileId, resolvedItemId, WATCHED_EVENT_TYPES, WATCH_STATE_EVENT_TYPES],
    );
    return result.rows[0]?.effective_watched === true;
  }

  private async loadCandidates(profileId: string, limit: number): Promise<Candidate[]> {
    const [continueWatching, history, watchlist] = await Promise.all([
      this.queryContinueWatching(profileId, limit),
      this.queryHistory(profileId, limit),
      this.queryWatchlist(profileId, limit),
    ]);

    const candidates = new Map<string, Candidate>();
    const addCandidate = (contentId: unknown, lastActivityAt: unknown) => {
      if (typeof contentId !== 'string') {
        return;
      }
      const showItemId = encodePublicItemId(contentId);
      if (candidates.has(showItemId)) {
        return;
      }
      candidates.set(showItemId, {
        showItemId,
        lastActivityAt: typeof lastActivityAt === 'string' ? lastActivityAt : null,
      });
    };

    for (const row of continueWatching) {
      addCandidate(row.show_item_id, row.last_activity_at);
    }
    for (const row of history) {
      addCandidate(row.show_item_id, row.occurred_at);
    }
    for (const row of watchlist) {
      addCandidate(row.show_item_id, row.added_at);
    }

    return Array.from(candidates.values()).sort((a, b) => String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? '')));
  }

  private async queryContinueWatching(profileId: string, limit: number): Promise<Array<{ show_item_id: string; last_activity_at: string }>> {
    const result = await db.query(
      `SELECT title_item_id AS show_item_id, last_activity_at
       FROM user_state.playback_progress
       WHERE profile_id = $1::uuid AND dismissed_at IS NULL AND title_item_id IS NOT NULL
       ORDER BY last_activity_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryHistory(profileId: string, limit: number): Promise<Array<{ show_item_id: string; occurred_at: string }>> {
    const result = await db.query(
      `SELECT title_item_id AS show_item_id, occurred_at
       FROM user_state.watch_events
       WHERE profile_id = $1::uuid AND media_type = 'episode' AND event_type = 'playback_completed' AND title_item_id IS NOT NULL
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryWatchlist(profileId: string, limit: number): Promise<Array<{ show_item_id: string; added_at: string }>> {
    const result = await db.query(
      `SELECT COALESCE(series_rel.parent_content_id, profile_list_items.item_id) AS show_item_id, added_at
       FROM user_state.profile_list_items
       LEFT JOIN content_item_relationships series_rel
         ON series_rel.child_content_id = profile_list_items.item_id
        AND series_rel.relationship_type = 'series'
       WHERE profile_id = $1::uuid AND list_kind = 'watchlist' AND media_type IN ('show', 'episode')
       ORDER BY added_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

}
