import type { DbClient } from '../../lib/db.js';
import { db } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import { assertPublicItemId, encodePublicItemId } from '../identity/public-item-id.js';
import { WATCHED_EVENT_TYPES, WATCH_STATE_EVENT_TYPES } from '../integrations/local-user-watch.service.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import type { MetadataCardView } from '../metadata/metadata-card.types.js';
import type { BaseItemDto } from '../metadata/media-item.types.js';
import { metadataCardToMediaItem, mediaItemToBaseItemDto } from '../metadata/media-item.mapper.js';
import type { TmdbEpisodeRecord } from '../metadata/providers/tmdb.types.js';

const CALENDAR_WINDOW_PAST_DAYS = 14;
const CALENDAR_WINDOW_FUTURE_DAYS = 60;
const MAX_EPISODES_PER_SHOW = 3;

type Candidate = {
  showItemId: string;
  showTmdbId: number;
  lastActivityAt: string | null;
  lastWatchedSeason: number | null;
  lastWatchedEpisode: number | null;
};

type EpisodeCandidate = {
  showItemId: string;
  showTmdbId: number;
  lastActivityAt: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episode: TmdbEpisodeRecord;
};

export class CalendarBuilderService {
  constructor(
    private readonly metadataCardService = new MetadataCardService(),
    private readonly contentIdentityService = new ContentIdentityService(),
  ) {}

  async build(client: DbClient, profileId: string, limit: number): Promise<BaseItemDto[]> {
    const candidates = await this.loadCandidates(client, profileId, Math.max(limit * 4, 50));
    if (candidates.length === 0) return [];

    const episodeCandidates = await this.expandEpisodes(client, candidates);
    const items: BaseItemDto[] = [];

    for (const ep of episodeCandidates) {
      if (items.length >= limit) break;
      const dto = await this.buildEpisodeItem(client, profileId, ep);
      if (dto) items.push(dto);
    }

    return items;
  }

  private async loadCandidates(
    client: DbClient,
    profileId: string,
    limit: number,
  ): Promise<Candidate[]> {
    const [continueWatching, history, watchlist] = await Promise.all([
      this.queryContinueWatching(profileId, limit),
      this.queryHistory(profileId, limit),
      this.queryWatchlist(profileId, limit),
    ]);

    const byShow = new Map<string, { lastActivityAt: string | null }>();
    const addCandidate = (contentId: unknown, lastActivityAt: unknown) => {
      if (typeof contentId !== 'string') return;
      const showItemId = encodePublicItemId(contentId);
      const existing = byShow.get(showItemId);
      const ts = typeof lastActivityAt === 'string' ? lastActivityAt : null;
      if (!existing || (ts && ts > (existing.lastActivityAt ?? ''))) {
        byShow.set(showItemId, { lastActivityAt: ts });
      }
    };

    for (const row of continueWatching) addCandidate(row.show_item_id, row.last_activity_at);
    for (const row of history) addCandidate(row.show_item_id, row.occurred_at);
    for (const row of watchlist) addCandidate(row.show_item_id, row.added_at);

    if (byShow.size === 0) return [];

    const showItemIds = Array.from(byShow.keys());
    const tmdbRefs = await this.resolveShowTmdbIds(client, showItemIds);

    const candidates: Candidate[] = [];
    for (const [showItemId, { lastActivityAt }] of byShow) {
      const tmdbId = tmdbRefs.get(showItemId);
      if (!tmdbId) continue;
      candidates.push({
        showItemId,
        showTmdbId: tmdbId,
        lastActivityAt,
        lastWatchedSeason: null,
        lastWatchedEpisode: null,
      });
    }

    await this.backfillLastWatched(client, profileId, candidates);

    return candidates;
  }

  private async resolveShowTmdbIds(client: DbClient, showItemIds: string[]): Promise<Map<string, number>> {
    const result = await client.query(
      `SELECT content_id, external_id
       FROM content_provider_refs
       WHERE content_id = ANY($1::uuid[]) AND provider = 'tmdb' AND entity_type = 'show'`,
      [showItemIds],
    );
    const map = new Map<string, number>();
    for (const row of result.rows) {
      const id = Number(row.external_id);
      if (Number.isFinite(id)) map.set(String(row.content_id), id);
    }
    return map;
  }

  private async backfillLastWatched(
    client: DbClient,
    profileId: string,
    candidates: Candidate[],
  ): Promise<void> {
    const showUuids = candidates.map((c) => {
      const raw = c.showItemId.replace(/^public:/, '');
      return `{${raw}}`;
    });

    const result = await client.query(
      `SELECT DISTINCT ON (title_item_id)
         title_item_id, season_number, episode_number
       FROM user_state.watch_events
       WHERE profile_id = $1::uuid
         AND media_type = 'episode'
         AND title_item_id = ANY($2::uuid[])
         AND season_number IS NOT NULL
         AND episode_number IS NOT NULL
       ORDER BY title_item_id, season_number DESC, episode_number DESC`,
      [profileId, showUuids],
    );

    const byId = new Map<string, { s: number; e: number }>();
    for (const row of result.rows) {
      byId.set(String(row.title_item_id), { s: Number(row.season_number), e: Number(row.episode_number) });
    }

    for (const c of candidates) {
      const raw = c.showItemId.replace(/^public:/, '');
      const found = byId.get(raw);
      if (found) {
        c.lastWatchedSeason = found.s;
        c.lastWatchedEpisode = found.e;
      }
    }
  }

  private async expandEpisodes(
    client: DbClient,
    candidates: Candidate[],
  ): Promise<EpisodeCandidate[]> {
    const tmdbIds = candidates.map((c) => c.showTmdbId);
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - CALENDAR_WINDOW_PAST_DAYS);
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + CALENDAR_WINDOW_FUTURE_DAYS);

    const episodesResult = await client.query(
      `SELECT show_tmdb_id, season_number, episode_number, name, air_date, still_path, runtime, overview
       FROM tmdb_tv_episodes
       WHERE show_tmdb_id = ANY($1::int[])
         AND air_date IS NOT NULL
         AND air_date::date BETWEEN $2::date AND $3::date
       ORDER BY show_tmdb_id, season_number ASC, episode_number ASC`,
      [tmdbIds, windowStart.toISOString().slice(0, 10), windowEnd.toISOString().slice(0, 10)],
    );

    const byShow = new Map<number, TmdbEpisodeRecord[]>();
    for (const row of episodesResult.rows) {
      const sid = Number(row.show_tmdb_id);
      if (!byShow.has(sid)) byShow.set(sid, []);
      byShow.get(sid)!.push({
        showTmdbId: sid,
        seasonNumber: Number(row.season_number),
        episodeNumber: Number(row.episode_number),
        tmdbId: null,
        name: row.name,
        overview: row.overview,
        airDate: row.air_date,
        runtime: row.runtime ? Number(row.runtime) : null,
        stillPath: row.still_path,
        voteAverage: null,
        raw: {},
        fetchedAt: '',
        expiresAt: '',
      });
    }

    const expanded: EpisodeCandidate[] = [];
    for (const c of candidates) {
      const showEpisodes = byShow.get(c.showTmdbId) ?? [];
      const lastS = c.lastWatchedSeason;
      const lastE = c.lastWatchedEpisode;

      const upcoming = showEpisodes.filter((ep) => {
        if (lastS === null) return true;
        return ep.seasonNumber > lastS ||
          (ep.seasonNumber === lastS && ep.episodeNumber > lastE!);
      });

      const limited = upcoming.slice(0, MAX_EPISODES_PER_SHOW);
      for (const ep of limited) {
        expanded.push({
          showItemId: c.showItemId,
          showTmdbId: c.showTmdbId,
          lastActivityAt: c.lastActivityAt,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          episode: ep,
        });
      }
    }

    expanded.sort((a, b) => {
      const aAir = a.episode.airDate ?? '';
      const bAir = b.episode.airDate ?? '';
      if (aAir !== bAir) return aAir.localeCompare(bAir);
      return String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? ''));
    });

    return expanded;
  }

  private async buildEpisodeItem(
    client: DbClient,
    profileId: string,
    ep: EpisodeCandidate,
  ): Promise<BaseItemDto | null> {
    const showIdentity = await this.contentIdentityService.resolveMediaIdentity(
      client, assertPublicItemId(ep.showItemId),
    ).catch(() => null);
    if (!showIdentity) return null;

    const showCard = await this.metadataCardService.buildCardView(client, showIdentity).catch(() => null);
    if (!showCard) return null;

    const showMediaItem = metadataCardToMediaItem(showCard, {
      itemId: showCard.itemId,
      images: {
        poster: showCard.images.poster,
        backdrop: showCard.images.backdrop,
        logo: showCard.images.logo,
        still: showCard.images.still,
      },
      airDate: ep.episode.airDate,
      episodeTitle: ep.episode.name,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
    });

    const dto = mediaItemToBaseItemDto(showMediaItem);
    dto.SeriesName = showCard.title;
    dto.ParentIndexNumber = ep.seasonNumber;
    dto.IndexNumber = ep.episodeNumber;
    dto.AirDate = ep.episode.airDate;

    if (ep.episode.stillPath) {
      dto.ImageTags = {
        Primary: null,
        Backdrop: [],
        Logo: null,
        Thumb: { small: ep.episode.stillPath, medium: ep.episode.stillPath, large: ep.episode.stillPath },
        Screenshot: [],
      };
    }

    dto.UserData = {
      ItemId: dto.Id,
      IsFavorite: false,
      Played: false,
      PlayCount: 0,
      PlaybackPositionTicks: null,
      RuntimeTicks: dto.RunTimeTicks,
      PlayedPercentage: null,
      LastPlayedDate: null,
      Rating: null,
      DismissedFromContinueWatching: false,
    };

    return dto;
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
