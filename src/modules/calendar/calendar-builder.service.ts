import type { DbClient } from '../../lib/db.js';
import { db } from '../../lib/db.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import type { MetadataCardView } from '../metadata/metadata-card.types.js';
import { parseMediaKey, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';
import type { CalendarItem } from '../watch/watch-read.types.js';
import { metadataCardToMediaItem } from '../metadata/media-item.mapper.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BUILD_CONCURRENCY = 4;

type Candidate = {
  showMediaKey: string;
  lastActivityAt: string | null;
};

export class CalendarBuilderService {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
    private readonly metadataProjectionService = new MetadataProjectionService(),
  ) {}

  async build(client: DbClient, profileId: string, limit: number): Promise<CalendarItem[]> {
    const candidates = await this.loadCandidates(profileId, Math.max(limit * 4, 50));
    const items: CalendarItem[] = [];
    const nowMs = Date.now();

    for (let i = 0; i < candidates.length && items.length < limit; i += BUILD_CONCURRENCY) {
      const batch = candidates.slice(i, i + BUILD_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async (candidate) => {
        const showIdentity = safeParseMediaKey(candidate.showMediaKey);
        if (!showIdentity) {
          return null;
        }

        const nextEpisode = await this.metadataProjectionService.resolveNextEpisode(client, showIdentity).catch(() => null);
        const showCard = await this.metadataCardService.buildCardView(client, showIdentity).catch(() => null);
        if (!showCard || !showCard.title) {
          return null;
        }

        const episodeIdentity = nextEpisode ? safeParseMediaKey(nextEpisode.mediaKey) : null;
        const watched = nextEpisode?.mediaKey
          ? await this.isWatched(profileId, nextEpisode.mediaKey)
          : false;
        const mediaCard = episodeIdentity
          ? await this.metadataCardService.buildCardView(client, episodeIdentity).catch(() => null)
          : showCard;
        if (!mediaCard || !mediaCard.title) {
          return null;
        }

        const bucket = this.bucketForAirDate(nextEpisode?.airDate ?? null, nowMs);
        const poster = mediaCard.images.poster ?? showCard.images.poster;
        const backdrop = mediaCard.images.backdrop ?? poster;

        const mediaItem = metadataCardToMediaItem(mediaCard, {
          images: {
            poster,
            backdrop,
            logo: mediaCard.images.logo,
            still: mediaCard.images.still,
          },
          airDate: nextEpisode?.airDate ?? null,
          episodeTitle: mediaCard.title,
        });
        const relatedShowMediaItem = metadataCardToMediaItem(showCard);

        return {
          bucket,
          kind: 'calendar_item' as const,
          mediaItem,
          context: {
            bucket,
            airDate: nextEpisode?.airDate ?? null,
            watched,
            relatedShow: relatedShowMediaItem,
          },
          presentation: { preferredSize: 'wide' as const, sectionId: null, sectionTitle: null },
          airDate: nextEpisode?.airDate ?? null,
          watched,
        };
      }));

      for (const result of batchResults) {
        if (result && items.length < limit) {
          items.push(result);
        }
      }
    }

    return items;
  }

  private async isWatched(profileId: string, mediaKey: string): Promise<boolean> {
    const result = await db.query(
      `SELECT effective_watched FROM user_state.media_watch_summary
       WHERE profile_id = $1::uuid AND media_key = $2`,
      [profileId, mediaKey],
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
    const addCandidate = (mediaKey: unknown, lastActivityAt: unknown) => {
      if (typeof mediaKey !== 'string') {
        return;
      }
      const showMediaKey = showMediaKeyFromMediaKey(mediaKey);
      if (!showMediaKey || candidates.has(showMediaKey)) {
        return;
      }
      candidates.set(showMediaKey, {
        showMediaKey,
        lastActivityAt: typeof lastActivityAt === 'string' ? lastActivityAt : null,
      });
    };

    for (const row of continueWatching) {
      addCandidate(row.title_media_key, row.last_activity_at);
      addCandidate(row.playable_media_key, row.last_activity_at);
    }
    for (const row of history) {
      addCandidate(row.media_key, row.occurred_at);
    }
    for (const row of watchlist) {
      addCandidate(row.media_key, row.added_at);
    }

    return Array.from(candidates.values()).sort((a, b) => String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? '')));
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

  private bucketForAirDate(airDate: string | null, nowMs: number): CalendarItem['bucket'] {
    const airDateMs = airDate ? Date.parse(airDate) : null;
    if (airDateMs === null || !Number.isFinite(airDateMs)) {
      return 'no_scheduled';
    }

    const now = new Date(nowMs);
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const day = now.getUTCDay();
    const startOfWeek = startOfToday - day * DAY_MS;
    const endOfWeek = startOfWeek + 7 * DAY_MS;

    if (airDateMs >= startOfWeek && airDateMs < endOfWeek) {
      return 'this_week';
    }
    if (airDateMs > endOfWeek) {
      return 'upcoming';
    }
    if (airDateMs >= startOfToday - 7 * DAY_MS) {
      return 'recently_released';
    }
    return 'up_next';
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
