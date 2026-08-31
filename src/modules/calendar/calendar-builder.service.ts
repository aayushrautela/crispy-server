import type { DbClient } from '../../lib/db.js';
import { db } from '../../lib/db.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { inferMediaIdentity, type MediaIdentity } from '../identity/media-key.js';
import { MetadataCardService } from '../metadata/metadata-card.service.js';
import type { MetadataCardView } from '../metadata/metadata-card.types.js';
import type { TmdbEpisodeRecord } from '../metadata/providers/tmdb.types.js';
import { resolveCalendarBuckets } from './calendar-buckets.js';
import type { CalendarItemDto } from './calendar.types.js';

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
  ) {}

  async build(client: DbClient, profileId: string, limit: number): Promise<CalendarItemDto[]> {
    const candidates = await this.loadCandidates(client, profileId, Math.max(limit * 4, 50));
    if (candidates.length === 0) return [];

    const expanded = await this.expandEpisodes(client, candidates);
    if (expanded.length === 0) return [];

    const built = await this.buildItems(client, candidates, expanded);

    const capped = built.slice(0, limit);
    const buckets = resolveCalendarBuckets(
      capped.map(({ showItemId, airDate }) => ({ showItemId, airDate })),
    );

    return capped.map((item, index) => ({ ...item.card, bucket: buckets[index]! }));
  }

  /**
   * Enriches every candidate episode through one batched card-view lookup.
   * Each item becomes a standardized episode card whose identity is the
   * episode's own canonical content item; show-level fields (logo, genres,
   * maturity rating, trailer) come from the show card view of the same batch.
   */
  private async buildItems(
    client: DbClient,
    candidates: Candidate[],
    expanded: EpisodeCandidate[],
  ): Promise<Array<{ card: Omit<CalendarItemDto, 'bucket'>; showItemId: string; airDate: string | null }>> {
    const showIdentityByTmdbId = new Map<number, MediaIdentity>();
    for (const candidate of candidates) {
      if (showIdentityByTmdbId.has(candidate.showTmdbId)) continue;
      try {
        showIdentityByTmdbId.set(
          candidate.showTmdbId,
          inferMediaIdentity({
            mediaType: 'show',
            provider: 'tmdb',
            providerId: String(candidate.showTmdbId),
          }),
        );
      } catch {
        // Unresolvable shows simply contribute no show-level enrichment.
      }
    }

    const showIndexes = new Map<number, number>();
    const identities: MediaIdentity[] = [];
    for (const [showTmdbId, identity] of showIdentityByTmdbId) {
      showIndexes.set(showTmdbId, identities.length);
      identities.push(identity);
    }
    const episodeBaseIndex = identities.length;

    const episodeIdentities = expanded.map((entry) => {
      try {
        return inferMediaIdentity({
          mediaType: 'episode',
          provider: 'tmdb',
          showTmdbId: entry.showTmdbId,
          seasonNumber: entry.seasonNumber,
          episodeNumber: entry.episodeNumber,
        });
      } catch {
        return null;
      }
    });
    for (const identity of episodeIdentities) {
      if (identity) identities.push(identity);
    }

    const views = await this.metadataCardService.buildCardViews(client, identities);

    const built: Array<{ card: Omit<CalendarItemDto, 'bucket'>; showItemId: string; airDate: string | null }> = [];
    let episodeCursor = episodeBaseIndex;
    for (let index = 0; index < expanded.length; index += 1) {
      const entry = expanded[index]!;
      const identity = episodeIdentities[index];
      if (!identity) continue;

      const episodeView = views[episodeCursor];
      episodeCursor += 1;
      if (!episodeView) continue;

      const showView = views[showIndexes.get(entry.showTmdbId) ?? -1] ?? null;
      const card = this.toCalendarCard(entry, episodeView, showView);
      if (!card) continue;

      built.push({ card, showItemId: entry.showItemId, airDate: entry.episode.airDate });
    }
    return built;
  }

  private toCalendarCard(
    entry: EpisodeCandidate,
    episodeView: MetadataCardView,
    showView: MetadataCardView | null,
  ): Omit<CalendarItemDto, 'bucket'> | null {
    if (!episodeView.title) return null;

    const externalIds = (showView ?? episodeView).externalIds;
    return {
      itemId: episodeView.itemId,
      mediaType: 'episode',
      title: episodeView.title,
      overview: episodeView.overview ?? episodeView.tagline ?? episodeView.summary,
      year: episodeView.releaseYear,
      releaseDate: episodeView.releaseDate,
      rating: episodeView.rating,
      maturityRating: showView?.maturityRating ?? episodeView.maturityRating,
      genres: showView?.genres ?? episodeView.genres,
      runtimeSeconds: typeof episodeView.runtimeMinutes === 'number' ? episodeView.runtimeMinutes * 60 : null,
      images: {
        artwork: episodeView.images.artwork,
        logo: showView?.images.logo ?? episodeView.images.logo,
        still: episodeView.images.still,
      },
      trailerUrl: showView?.trailerUrl ?? episodeView.trailerUrl,
      progress: null,
      parent: {
        seriesItemId: episodeView.seriesItemId ?? showView?.itemId ?? undefined,
        seriesTitle: showView?.title ?? undefined,
        seasonItemId: episodeView.seasonItemId ?? undefined,
        seasonNumber: episodeView.seasonNumber,
        episodeNumber: episodeView.episodeNumber,
      },
      providerIds: {
        tmdb: externalIds.tmdb != null ? String(externalIds.tmdb) : String(entry.showTmdbId),
        tvdb: externalIds.tvdb != null ? String(externalIds.tvdb) : null,
        imdb: externalIds.imdb ?? null,
      },
      airDate: entry.episode.airDate,
    };
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
      `SELECT DISTINCT ON (title_item_id) title_item_id, season_number, episode_number
       FROM (
         SELECT COALESCE(cir.parent_content_id, ws.item_id) AS title_item_id,
                NULLIF(cpr.metadata->>'seasonNumber', '')::integer AS season_number,
                NULLIF(cpr.metadata->>'episodeNumber', '')::integer AS episode_number
         FROM user_state.watch_state ws
         JOIN content_items ci ON ci.id = ws.item_id
         LEFT JOIN content_item_relationships cir ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
         LEFT JOIN content_provider_refs cpr ON cpr.content_id = ws.item_id AND cpr.provider = 'tmdb'
         WHERE ws.profile_id = $1::uuid
           AND ci.entity_type = 'episode'
           AND COALESCE(cir.parent_content_id, ws.item_id) = ANY($2::uuid[])
           AND NULLIF(cpr.metadata->>'seasonNumber', '')::integer IS NOT NULL
           AND NULLIF(cpr.metadata->>'episodeNumber', '')::integer IS NOT NULL
       ) sub
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

  private async queryContinueWatching(profileId: string, limit: number): Promise<Array<{ show_item_id: string; last_activity_at: string }>> {
    const result = await db.query(
      `SELECT COALESCE(cir.parent_content_id, ws.item_id) AS show_item_id, ws.last_played_at AS last_activity_at
       FROM user_state.watch_state ws
       LEFT JOIN content_item_relationships cir ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
       WHERE ws.profile_id = $1::uuid AND NOT ws.played AND ws.position_seconds > 0 AND COALESCE(cir.parent_content_id, ws.item_id) IS NOT NULL
       ORDER BY ws.last_played_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryHistory(profileId: string, limit: number): Promise<Array<{ show_item_id: string; occurred_at: string }>> {
    const result = await db.query(
      `SELECT COALESCE(cir.parent_content_id, ws.item_id) AS show_item_id, ws.last_played_at AS occurred_at
       FROM user_state.watch_state ws
       JOIN content_items ci ON ci.id = ws.item_id
       LEFT JOIN content_item_relationships cir ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
       WHERE ws.profile_id = $1::uuid AND ci.entity_type = 'episode' AND ws.played AND ws.last_played_at IS NOT NULL AND COALESCE(cir.parent_content_id, ws.item_id) IS NOT NULL
       ORDER BY ws.last_played_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryWatchlist(profileId: string, limit: number): Promise<Array<{ show_item_id: string; added_at: string }>> {
    const result = await db.query(
      `SELECT COALESCE(cir.parent_content_id, ws.item_id) AS show_item_id, ws.last_played_at AS added_at
       FROM user_state.watch_state ws
       JOIN content_items ci ON ci.id = ws.item_id
       LEFT JOIN content_item_relationships cir ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
       WHERE ws.profile_id = $1::uuid AND ws.is_favorite AND ci.entity_type IN ('show', 'episode') AND COALESCE(cir.parent_content_id, ws.item_id) IS NOT NULL
       ORDER BY ws.last_played_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }
}
