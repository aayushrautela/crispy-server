import type { DbClient } from '../../lib/db.js';
import { requireDbIsoString } from '../../lib/time.js';
import { episodeRefMapKey, type ContentIdentityService } from '../identity/content-identity.service.js';
import { inferMediaIdentity, showTmdbIdForIdentity, type MediaIdentity } from '../identity/media-key.js';
import { TmdbCacheService } from '../metadata/providers/tmdb-cache.service.js';
import { toEpisodicSeriesIdentity } from './watch-v2-utils.js';

export async function listWatchV2WatchedEpisodeKeys(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  tmdbCacheService: TmdbCacheService,
  profileId: string,
  identity: MediaIdentity,
  titleContentId: string,
): Promise<string[]> {
  const seriesIdentity = toEpisodicSeriesIdentity(identity);
  if (!seriesIdentity) {
    return [];
  }

  const [titleOverrideResult, exactEpisodeResult] = await Promise.all([
    client.query(
      `
        SELECT override_state, applies_through_release_at
        FROM profile_watch_override
        WHERE profile_id = $1::uuid AND target_content_id = $2::uuid
      `,
      [profileId, titleContentId],
    ),
    client.query(
      `
        SELECT DISTINCT content_id
        FROM (
          SELECT content_id
          FROM profile_playable_state
          WHERE profile_id = $1::uuid AND title_content_id = $2::uuid AND last_completed_at IS NOT NULL
          UNION
          SELECT content_id
          FROM profile_play_history
          WHERE profile_id = $1::uuid AND title_content_id = $2::uuid AND voided_at IS NULL
        ) watched_episodes
      `,
      [profileId, titleContentId],
    ),
  ]);

  const exactWatchedIds = exactEpisodeResult.rows.map((row: Record<string, unknown>) => String(row.content_id));
  const exactKeys = await resolveEpisodeKeys(client, contentIdentityService, exactWatchedIds);
  const watchedKeys = new Set(exactKeys);

  const titleOverride = titleOverrideResult.rows[0] ?? null;
  if (titleOverride?.override_state !== 'watched') {
    return Array.from(watchedKeys).sort();
  }

  const showTmdbId = showTmdbIdForIdentity(seriesIdentity);
  const episodes = showTmdbId
    ? await tmdbCacheService.listEpisodesForShow(client, showTmdbId).catch(() => [])
    : [];
  if (!episodes.length) {
    return Array.from(watchedKeys).sort();
  }

  const episodeInputs = episodes.map((episode) => ({
    parentMediaType: 'show' as const,
    provider: 'tmdb' as const,
    parentProviderId: String(episode.showTmdbId),
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
  }));
  const episodeContentIds = await contentIdentityService.ensureEpisodeContentIds(client, episodeInputs);
  const allEpisodeContentIds = Array.from(episodeContentIds.values());
  let exactUnwatchedIds = new Set<string>();
  if (allEpisodeContentIds.length > 0) {
    const unwatchedResult = await client.query(
      `
        SELECT target_content_id
        FROM profile_watch_override
        WHERE profile_id = $1::uuid
          AND target_kind = 'episode'
          AND override_state = 'unwatched'
          AND target_content_id = ANY($2::uuid[])
      `,
      [profileId, allEpisodeContentIds],
    );
    exactUnwatchedIds = new Set(unwatchedResult.rows.map((row: Record<string, unknown>) => String(row.target_content_id)));
  }

  const cutoff = requireOptionalIsoString(titleOverride.applies_through_release_at as Date | string | null | undefined);
  for (const episode of episodes) {
    const contentId = episodeContentIds.get(episodeRefMapKey(
      String(episode.showTmdbId),
      episode.seasonNumber,
      episode.episodeNumber,
      null,
    ));
    if (!contentId || exactUnwatchedIds.has(contentId) || !isReleasedByCutoff(episode.airDate, cutoff)) {
      continue;
    }

    watchedKeys.add(inferMediaIdentity({
      contentId,
      mediaType: 'episode',
      provider: 'tmdb',
      parentProvider: 'tmdb',
      parentProviderId: String(episode.showTmdbId),
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    }).mediaKey);
  }

  return Array.from(watchedKeys).sort();
}

async function resolveEpisodeKeys(
  client: DbClient,
  contentIdentityService: ContentIdentityService,
  contentIds: string[],
): Promise<string[]> {
  const identities = await Promise.all(contentIds.map(async (contentId) => {
    const reference = await contentIdentityService.resolveContentReference(client, contentId).catch(() => null);
    return reference && reference.entityType === 'episode' ? reference.mediaIdentity.mediaKey : null;
  }));
  return identities.filter((mediaKey): mediaKey is string => mediaKey !== null);
}

function requireOptionalIsoString(value: Date | string | null | undefined): string | null {
  return value ? requireDbIsoString(value, 'watch_v2_episode_keys.timestamp') : null;
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
