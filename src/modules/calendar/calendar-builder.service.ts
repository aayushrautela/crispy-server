import type { DbClient } from '../../lib/db.js';
import { getSupabaseServiceRoleClient } from '../../lib/supabase.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import { MetadataProjectionService } from '../metadata/metadata-projection.service.js';
import type { MetadataCardView } from '../metadata/metadata-card.types.js';
import { parseMediaKey, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';
import type { CalendarItem } from '../watch/watch-read.types.js';
import { metadataCardToMediaItem } from '../metadata/media-item.mapper.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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

    for (const candidate of candidates) {
      if (items.length >= limit) {
        break;
      }

      const showIdentity = safeParseMediaKey(candidate.showMediaKey);
      if (!showIdentity) {
        continue;
      }

      const nextEpisode = await this.metadataProjectionService.resolveNextEpisode(client, showIdentity).catch(() => null);
      const showCard = await this.metadataCardService.buildCardView(client, showIdentity).catch(() => null);
      if (!showCard || !showCard.title) {
        continue;
      }

      const episodeIdentity = nextEpisode ? safeParseMediaKey(nextEpisode.mediaKey) : null;
      const mediaCard = episodeIdentity
        ? await this.metadataCardService.buildCardView(client, episodeIdentity).catch(() => null)
        : showCard;
      if (!mediaCard || !mediaCard.title) {
        continue;
      }

      const bucket = this.bucketForAirDate(nextEpisode?.airDate ?? null, nowMs);
      const poster = mediaCard.images.poster ?? showCard.images.poster;
      const backdrop = mediaCard.images.still
        ?? mediaCard.images.backdrop
        ?? showCard.images.backdrop
        ?? poster;

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

      items.push({
        bucket,
        kind: 'calendar_item',
        mediaItem,
        context: {
          bucket,
          airDate: nextEpisode?.airDate ?? null,
          watched: false,
          relatedShow: relatedShowMediaItem,
        },
        presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
        airDate: nextEpisode?.airDate ?? null,
        watched: false,
      });
    }

    return items;
  }

  private async loadCandidates(profileId: string, limit: number): Promise<Candidate[]> {
    const supabase = getSupabaseServiceRoleClient();
    const [continueWatching, history, watchlist] = await Promise.all([
      supabase
        .from('continue_watching_items')
        .select('title_media_key, playable_media_key, last_activity_at')
        .eq('profile_id', profileId)
        .is('dismissed_at', null)
        .order('last_activity_at', { ascending: false })
        .limit(limit),
      supabase
        .from('watch_history')
        .select('media_key, watched_at')
        .eq('profile_id', profileId)
        .eq('media_type', 'episode')
        .order('watched_at', { ascending: false })
        .limit(limit),
      supabase
        .from('profile_list_items')
        .select('media_key, added_at')
        .eq('profile_id', profileId)
        .eq('list_kind', 'watchlist')
        .in('media_type', ['show', 'episode'])
        .order('added_at', { ascending: false })
        .limit(limit),
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

    for (const row of continueWatching.data ?? []) {
      addCandidate(row.title_media_key, row.last_activity_at);
      addCandidate(row.playable_media_key, row.last_activity_at);
    }
    for (const row of history.data ?? []) {
      addCandidate(row.media_key, row.watched_at);
    }
    for (const row of watchlist.data ?? []) {
      addCandidate(row.media_key, row.added_at);
    }

    return Array.from(candidates.values()).sort((a, b) => String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? '')));
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
