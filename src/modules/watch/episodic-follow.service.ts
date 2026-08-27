import type { DbClient } from '../../lib/db.js';
import { ContentIdentityService } from '../identity/content-identity.service.js';
import type { ContentProviderRefRecord } from '../identity/content-identity.repo.js';
import { type MediaIdentity, inferMediaIdentity } from '../identity/media-key.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import type { CanonicalNextEpisodeRef, EpisodicFollowInternal } from './watch-episodic-follow.types.js';
import {
  type EpisodeSeasonRef,
  type LastWatchedRef,
  nextReleasedEpisodeAfter,
} from './episodic-follow-policy.js';

type Candidate = {
  showItemId: string;
  reason: string;
  lastInteractedAt: string;
};

export class EpisodicFollowService {
  constructor(private readonly contentIdentityService = new ContentIdentityService()) {}

  async listForProfile(client: DbClient, profileId: string, limit: number): Promise<EpisodicFollowInternal[]> {
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
      const showTmdbId = this.extractShowTmdbId(tmdbRef);
      if (showTmdbId == null) {
        continue;
      }
      const identity = this.buildShowIdentity(showItemId, showTmdbId);
      identitiesByItem.set(showItemId, identity);
      resolvedIdentities.push(identity);
    }

    if (!resolvedIdentities.length) {
      return [];
    }

    const showTmdbIds = resolvedIdentities
      .map((identity) => Number(identity.tmdbId))
      .filter((tmdbId) => Number.isFinite(tmdbId));

    const [lastWatchedByShow, episodesByShow, showUnairedNextUp] = await Promise.all([
      this.loadLastWatchedByShow(client, profileId, showItemIds),
      showTmdbIds.length
        ? this.loadEpisodesByShow(client, showTmdbIds)
        : Promise.resolve(new Map<number, EpisodeSeasonRef[]>()),
      this.readShowUnairedNextUp(client, profileId),
    ]);

    const todayIso = new Date().toISOString();
    const nextEpisodeByItem = new Map<string, CanonicalNextEpisodeRef>();
    for (const identity of resolvedIdentities) {
      const showItemId = identity.contentId;
      if (!showItemId) {
        continue;
      }

      const showTmdbId = Number(identity.tmdbId);
      const lastWatched = lastWatchedByShow.get(showItemId) ?? null;
      const episodes = episodesByShow.get(showTmdbId) ?? [];
      const next = nextReleasedEpisodeAfter({ episodes, lastWatched, todayIso, showUnairedNextUp });
      if (!next) {
        continue;
      }

      const episodeIdentity = this.buildEpisodeIdentity(identity, next);
      const contentId = await this.contentIdentityService.ensureContentId(client, episodeIdentity);
      nextEpisodeByItem.set(showItemId, {
        itemId: encodePublicItemId(contentId),
        airDate: next.airDate,
        seasonNumber: next.seasonNumber,
        episodeNumber: next.episodeNumber,
        absoluteEpisodeNumber: null,
      });
    }

    if (!nextEpisodeByItem.size) {
      return [];
    }

    const items: EpisodicFollowInternal[] = [];
    for (const candidate of candidates) {
      if (items.length >= limit) break;
      const nextEpisode = nextEpisodeByItem.get(candidate.showItemId);
      if (!nextEpisode) continue;
      // Ensure show identity still resolvable (skip stale candidates)
      if (!identitiesByItem.has(candidate.showItemId)) continue;
      items.push({
        showItemId: candidate.showItemId,
        reason: candidate.reason,
        lastInteractedAt: candidate.lastInteractedAt,
        nextEpisode,
      });
    }

    return items;
  }

  private buildShowIdentity(showItemId: string, showTmdbId: number): MediaIdentity {
    const tmdb = String(showTmdbId);
    return {
      mediaKey: `show:tmdb:${tmdb}`,
      mediaType: 'show',
      provider: 'tmdb',
      providerId: tmdb,
      tmdbId: showTmdbId,
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

  private extractShowTmdbId(ref: ContentProviderRefRecord): number | null {
    if (ref.entityType === 'show') {
      const numeric = Number(ref.externalId);
      return Number.isFinite(numeric) ? numeric : null;
    }

    const metadataShowTmdbId = ref.metadata?.showTmdbId;
    if (typeof metadataShowTmdbId === 'number' && Number.isFinite(metadataShowTmdbId)) {
      return metadataShowTmdbId;
    }
    if (typeof metadataShowTmdbId === 'string') {
      const numeric = Number(metadataShowTmdbId);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }

    if (ref.entityType === 'episode' || ref.entityType === 'season') {
      const numeric = Number(String(ref.externalId).split(':')[0]);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }

    return null;
  }

  private buildEpisodeIdentity(showIdentity: MediaIdentity, episode: EpisodeSeasonRef): MediaIdentity {
    const showTmdbId = Number(showIdentity.tmdbId);
    return inferMediaIdentity({
      mediaType: 'episode',
      provider: 'tmdb',
      providerId: episode.tmdbId != null ? String(episode.tmdbId) : String(showTmdbId),
      parentProvider: 'tmdb',
      parentProviderId: String(showTmdbId),
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      providerMetadata: { tmdbId: showTmdbId, showTmdbId },
    });
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

  private async queryContinueWatching(
    client: DbClient,
    profileId: string,
    limit: number,
  ): Promise<Array<{ title_item_id: string; playable_item_id: string; last_activity_at: string }>> {
    const result = await client.query(
      `SELECT COALESCE(cir.parent_content_id, ws.item_id) AS title_item_id, ws.item_id AS playable_item_id, ws.last_played_at AS last_activity_at
       FROM user_state.watch_state ws
       LEFT JOIN content_item_relationships cir ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
       WHERE ws.profile_id = $1::uuid AND NOT ws.played AND ws.position_seconds > 0
       ORDER BY ws.last_played_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryHistory(
    client: DbClient,
    profileId: string,
    limit: number,
  ): Promise<Array<{ title_item_id: string; occurred_at: string }>> {
    const result = await client.query(
       `SELECT COALESCE(cir.parent_content_id, ws.item_id) AS title_item_id, ws.last_played_at AS occurred_at
        FROM user_state.watch_state ws
        JOIN content_items ci ON ci.id = ws.item_id
        LEFT JOIN content_item_relationships cir ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
        WHERE ws.profile_id = $1::uuid AND ci.entity_type = 'episode' AND ws.played AND ws.last_played_at IS NOT NULL
        ORDER BY ws.last_played_at DESC
        LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async queryWatchlist(
    client: DbClient,
    profileId: string,
    limit: number,
  ): Promise<Array<{ item_id: string; added_at: string }>> {
    const result = await client.query(
      `SELECT COALESCE(cir.parent_content_id, ws.item_id) AS item_id, ws.last_played_at AS added_at
       FROM user_state.watch_state ws
       JOIN content_items ci ON ci.id = ws.item_id
       LEFT JOIN content_item_relationships cir ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
       WHERE ws.profile_id = $1::uuid AND ws.is_favorite AND ci.entity_type IN ('show', 'episode')
       ORDER BY ws.last_played_at DESC
       LIMIT $2`,
      [profileId, limit],
    );
    return result.rows;
  }

  private async loadLastWatchedByShow(
    client: DbClient,
    profileId: string,
    showItemIds: string[],
  ): Promise<Map<string, LastWatchedRef>> {
    const result = await client.query(
       `SELECT COALESCE(cir.parent_content_id, ws.item_id) AS title_item_id,
               NULLIF(cpr.metadata->>'seasonNumber', '')::integer AS season_number,
               NULLIF(cpr.metadata->>'episodeNumber', '')::integer AS episode_number
        FROM user_state.watch_state ws
        JOIN content_items ci ON ci.id = ws.item_id
        LEFT JOIN content_item_relationships cir ON cir.child_content_id = ws.item_id AND cir.relationship_type = 'series'
        LEFT JOIN content_provider_refs cpr ON cpr.content_id = ws.item_id AND cpr.provider = 'tmdb'
        WHERE ws.profile_id = $1::uuid AND COALESCE(cir.parent_content_id, ws.item_id) = ANY($2::uuid[])
          AND ci.entity_type = 'episode'
          AND NULLIF(cpr.metadata->>'seasonNumber', '')::integer IS NOT NULL
          AND NULLIF(cpr.metadata->>'episodeNumber', '')::integer IS NOT NULL`,
      [profileId, showItemIds],
    );

    const latestByShow = new Map<string, { season: number; episode: number }>();
    for (const row of result.rows) {
      const season = Number(row.season_number);
      const episode = Number(row.episode_number);
      if (!Number.isFinite(season) || !Number.isFinite(episode)) {
        continue;
      }
      const existing = latestByShow.get(row.title_item_id);
      if (!existing || season > existing.season || (season === existing.season && episode > existing.episode)) {
        latestByShow.set(row.title_item_id, { season, episode });
      }
    }

    const out = new Map<string, LastWatchedRef>();
    for (const [showItemId, latest] of latestByShow) {
      out.set(showItemId, { seasonNumber: latest.season, episodeNumber: latest.episode });
    }
    return out;
  }

  private async loadEpisodesByShow(
    client: DbClient,
    showTmdbIds: number[],
  ): Promise<Map<number, EpisodeSeasonRef[]>> {
    const result = await client.query(
      `SELECT show_tmdb_id, season_number, episode_number, air_date, tmdb_id
       FROM tmdb.tmdb_tv_episodes
       WHERE show_tmdb_id = ANY($1::int[]) AND season_number > 0`,
      [showTmdbIds],
    );

    const byShow = new Map<number, EpisodeSeasonRef[]>();
    for (const row of result.rows) {
      const showTmdbId = Number(row.show_tmdb_id);
      const list = byShow.get(showTmdbId) ?? [];
      list.push({
        seasonNumber: Number(row.season_number),
        episodeNumber: Number(row.episode_number),
        airDate: row.air_date ? String(row.air_date).slice(0, 10) : null,
        tmdbId: row.tmdb_id == null ? null : Number(row.tmdb_id),
      });
      byShow.set(showTmdbId, list);
    }

    for (const list of byShow.values()) {
      list.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    }
    return byShow;
  }

  private async readShowUnairedNextUp(client: DbClient, profileId: string): Promise<boolean> {
    const result = await client.query(
      `SELECT settings_json FROM identity.profile_preferences WHERE profile_id = $1::uuid`,
      [profileId],
    );
    const settings = result.rows[0]?.settings_json as Record<string, unknown> | undefined;
    return settings?.show_unaired_next_up === true;
  }
}
