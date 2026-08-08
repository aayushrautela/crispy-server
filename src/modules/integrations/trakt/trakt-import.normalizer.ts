import {
  inferMediaIdentity,
  type MediaIdentity,
} from '../../identity/media-key.js';
import { firstIsoString, getRecord, asArray, asPositiveInt, asString, asFiniteNumber, normalizeProviderId, durationSecondsFromRuntime, clampProgressBps } from '../provider-import.utils.js';
import type {
  ImportAccumulator,
  ImportedHistoryEntryDraft,
  ImportedWatchEventDraft,
  ResolvedImportIdentity,
} from '../provider-import.internals.js';

type ResolveIdentityFn = (params: {
  mediaFamily: 'movie' | 'show' | 'anime';
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: string | null;
  kitsuId?: number | string | null;
}) => Promise<ResolvedImportIdentity | null>;

function traktPayload(source: 'watched_movies' | 'watched_shows' | 'watchlist' | 'ratings'): Record<string, unknown> {
  return { provider: 'trakt', source };
}

function traktItemMediaFamily(item: Record<string, unknown>): 'movie' | 'show' | null {
  if (getRecord(item.movie)) {
    return 'movie';
  }
  if (getRecord(item.show)) {
    return 'show';
  }
  return null;
}

function traktLookupFromNode(
  node: Record<string, unknown> | null,
  mediaFamily: 'movie' | 'show' | 'anime',
): {
  mediaFamily: 'movie' | 'show' | 'anime';
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: string | null;
  kitsuId?: number | string | null;
} {
  const ids = getRecord(node?.ids);
  return {
    mediaFamily,
    tmdbId: asPositiveInt(ids?.tmdb),
    imdbId: asString(ids?.imdb),
    tvdbId: mediaFamily === 'show' ? normalizeProviderId(ids?.tvdb) : null,
    kitsuId: mediaFamily === 'anime' ? normalizeProviderId(ids?.kitsu) : null,
  };
}

async function resolveTraktTitleIdentity(
  resolveIdentity: ResolveIdentityFn,
  item: Record<string, unknown>,
  mediaFamily: 'movie' | 'show',
): Promise<ResolvedImportIdentity | null> {
  const node = mediaFamily === 'movie' ? getRecord(item.movie) : getRecord(item.show);
  return resolveIdentity(traktLookupFromNode(node, mediaFamily));
}

function buildImportedTitleEvent(params: {
  eventType: ImportedWatchEventDraft['eventType'];
  resolved: ResolvedImportIdentity;
  occurredAt: string;
  rating?: number | null;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  progressBps?: number | null;
  payload: Record<string, unknown>;
  includeShowTmdbId?: boolean;
}): ImportedWatchEventDraft {
  return {
    eventType: params.eventType,
    mediaKey: params.resolved.identity.mediaKey,
    mediaType: params.resolved.mediaType,
    provider: params.resolved.identity.provider,
    providerId: params.resolved.identity.providerId,
    tmdbId: params.resolved.tmdbId,
    tvdbId: params.resolved.tvdbId,
    kitsuId: params.resolved.kitsuId,
    showTmdbId: params.includeShowTmdbId && params.resolved.mediaType !== 'movie' ? params.resolved.tmdbId : null,
    rating: params.rating ?? null,
    positionSeconds: params.positionSeconds ?? null,
    durationSeconds: params.durationSeconds ?? null,
    progressBps: params.progressBps ?? null,
    occurredAt: params.occurredAt,
    payload: params.payload,
  };
}

function buildImportedTitleHistoryEntry(params: {
  resolved: ResolvedImportIdentity;
  watchedAt: string;
  payload: Record<string, unknown>;
}): ImportedHistoryEntryDraft {
  return {
    mediaKey: params.resolved.identity.mediaKey,
    mediaType: params.resolved.mediaType,
    provider: params.resolved.identity.provider,
    providerId: params.resolved.identity.providerId,
    tmdbId: params.resolved.tmdbId,
    tvdbId: params.resolved.tvdbId,
    kitsuId: params.resolved.kitsuId,
    watchedAt: params.watchedAt,
    sourceKind: 'provider_import',
    payload: params.payload,
  };
}

function buildImportedEpisodeIdentity(
  resolvedShow: ResolvedImportIdentity,
  seasonNumber: number,
  episodeNumber: number,
): MediaIdentity {
  return inferMediaIdentity({
    mediaType: 'episode',
    provider: resolvedShow.identity.provider,
    parentProvider: resolvedShow.identity.provider,
    parentProviderId: resolvedShow.identity.providerId,
    seasonNumber,
    episodeNumber,
    tvdbId: resolvedShow.tvdbId,
    kitsuId: resolvedShow.kitsuId,
    providerMetadata: resolvedShow.tmdbId ? { tmdbId: resolvedShow.tmdbId } : undefined,
  });
}

function buildImportedEpisodeEvent(params: {
  eventType: ImportedWatchEventDraft['eventType'];
  identity: MediaIdentity;
  resolvedShow: ResolvedImportIdentity;
  occurredAt: string;
  positionSeconds?: number | null;
  durationSeconds?: number | null;
  progressBps?: number | null;
  payload: Record<string, unknown>;
}): ImportedWatchEventDraft {
  return {
    eventType: params.eventType,
    mediaKey: params.identity.mediaKey,
    mediaType: 'episode',
    provider: params.identity.provider,
    providerId: params.identity.providerId,
    parentProvider: params.identity.parentProvider,
    parentProviderId: params.identity.parentProviderId,
    tmdbId: params.identity.tmdbId,
    tvdbId: params.resolvedShow.tvdbId,
    kitsuId: params.resolvedShow.kitsuId,
    showTmdbId: params.resolvedShow.tmdbId,
    seasonNumber: params.identity.seasonNumber,
    episodeNumber: params.identity.episodeNumber,
    absoluteEpisodeNumber: params.identity.absoluteEpisodeNumber,
    positionSeconds: params.positionSeconds ?? null,
    durationSeconds: params.durationSeconds ?? null,
    progressBps: params.progressBps ?? null,
    occurredAt: params.occurredAt,
    payload: params.payload,
  };
}

function traktPlaybackPayload(item: Record<string, unknown>, progress: number | null): Record<string, unknown> {
  return {
    provider: 'trakt',
    source: 'playback',
    playbackId: normalizeProviderId(item.id),
    progressPercent: progress,
  };
}

function traktPlaybackSnapshot(item: Record<string, unknown>, runtime: unknown): {
  eventType: ImportedWatchEventDraft['eventType'];
  progress: number | null;
  progressBps: number | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  occurredAt: string;
} {
  const progress = asFiniteNumber(item.progress);
  const progressBps = progress === null ? null : clampProgressBps(Math.round(progress * 100));
  const durationSeconds = durationSecondsFromRuntime(runtime);
  const positionSeconds = progress !== null && durationSeconds !== null
    ? Math.max(1, Math.round((durationSeconds * progress) / 100))
    : null;

  return {
    eventType: progress !== null && progress >= 90 ? 'playback_completed' : 'playback_progress_snapshot',
    progress,
    progressBps,
    positionSeconds,
    durationSeconds,
    occurredAt: firstIsoString(item.paused_at) ?? new Date().toISOString(),
  };
}

export async function normalizeTraktWatchedMovies(
  items: Array<Record<string, unknown>>,
  resolveIdentity: ResolveIdentityFn,
  collector: ImportAccumulator,
): Promise<void> {
  for (const item of items) {
    const resolved = await resolveTraktTitleIdentity(resolveIdentity, item, 'movie');
    if (!resolved) {
      continue;
    }
    const occurredAt = firstIsoString(item.last_watched_at) ?? new Date().toISOString();
    collector.importedEvents.push(buildImportedTitleEvent({
      eventType: 'mark_watched',
      resolved,
      occurredAt,
      payload: traktPayload('watched_movies'),
    }));
    collector.importedHistoryEntries.push(buildImportedTitleHistoryEntry({
      resolved,
      watchedAt: occurredAt,
      payload: traktPayload('watched_movies'),
    }));
    collector.mediaKeysToRefresh.add(resolved.identity.mediaKey);
  }
}

/**
 * Trakt's /sync/watched/shows endpoint returns `{plays, last_watched_at, show}`
 * by default. Adding `?extended=progress` returns the full per-season,
 * per-episode breakdown we need to emit one history row per watched episode:
 * `seasons: [{number, episodes: [{number, plays, last_watched_at}]}]`.
 */
export type ShowProgress = {
  resolvedShow: ResolvedImportIdentity;
  highestSeason: number;
  highestEpisode: number;
  episodeCount: number;
};

export async function normalizeTraktWatchedShows(
  items: Array<Record<string, unknown>>,
  resolveIdentity: ResolveIdentityFn,
  collector: ImportAccumulator,
  showProgress?: Map<string, ShowProgress>,
): Promise<void> {
  for (const item of items) {
    const resolvedShow = await resolveTraktTitleIdentity(resolveIdentity, item, 'show');
    if (!resolvedShow) {
      continue;
    }

    const seasons = asArray(item.seasons);
    if (seasons.length === 0) {
      continue;
    }

    let emittedForShow = false;
    for (const seasonValue of seasons) {
      const season = getRecord(seasonValue);
      const seasonNumber = asPositiveInt(season?.number);
      if (!seasonNumber) {
        continue;
      }
      for (const episodeValue of asArray(season?.episodes)) {
        const episode = getRecord(episodeValue);
        const episodeNumber = asPositiveInt(episode?.number);
        if (!episodeNumber) {
          continue;
        }
        const occurredAt = firstIsoString(episode?.last_watched_at)
          ?? firstIsoString(item.last_watched_at, item.last_updated_at)
          ?? new Date().toISOString();

        const identity = buildImportedEpisodeIdentity(resolvedShow, seasonNumber, episodeNumber);
        collector.importedEvents.push(buildImportedEpisodeEvent({
          eventType: 'mark_watched',
          identity,
          resolvedShow,
          occurredAt,
          payload: traktPayload('watched_shows'),
        }));
        collector.importedHistoryEntries.push({
          mediaKey: identity.mediaKey,
          mediaType: 'episode',
          provider: identity.provider,
          providerId: identity.providerId,
          tmdbId: identity.tmdbId,
          tvdbId: resolvedShow.tvdbId,
          kitsuId: resolvedShow.kitsuId,
          watchedAt: occurredAt,
          sourceKind: 'provider_import',
          payload: traktPayload('watched_shows'),
        });
        collector.mediaKeysToRefresh.add(resolvedShow.identity.mediaKey);
        const existing = showProgress?.get(resolvedShow.identity.mediaKey);
        if (existing) {
          existing.episodeCount += 1;
          if (seasonNumber > existing.highestSeason ||
              (seasonNumber === existing.highestSeason && episodeNumber > existing.highestEpisode)) {
            existing.highestSeason = seasonNumber;
            existing.highestEpisode = episodeNumber;
          }
        } else {
          showProgress?.set(resolvedShow.identity.mediaKey, {
            resolvedShow,
            highestSeason: seasonNumber,
            highestEpisode: episodeNumber,
            episodeCount: 1,
          });
        }
        emittedForShow = true;
      }
    }
    if (!emittedForShow) {
      collector.mediaKeysToRefresh.add(resolvedShow.identity.mediaKey);
    }
  }
}

export async function normalizeTraktWatchlist(
  items: Array<Record<string, unknown>>,
  resolveIdentity: ResolveIdentityFn,
  collector: ImportAccumulator,
): Promise<void> {
  for (const item of items) {
    const mediaFamily = traktItemMediaFamily(item);
    if (!mediaFamily) {
      continue;
    }
    const resolved = await resolveTraktTitleIdentity(resolveIdentity, item, mediaFamily);
    if (!resolved) {
      continue;
    }
    const occurredAt = firstIsoString(item.listed_at) ?? new Date().toISOString();
    collector.importedEvents.push(buildImportedTitleEvent({
      eventType: 'watchlist_put',
      resolved,
      occurredAt,
      payload: traktPayload('watchlist'),
      includeShowTmdbId: true,
    }));
    collector.mediaKeysToRefresh.add(resolved.identity.mediaKey);
  }
}

export async function normalizeTraktRatings(
  items: Array<Record<string, unknown>>,
  resolveIdentity: ResolveIdentityFn,
  collector: ImportAccumulator,
): Promise<void> {
  for (const item of items) {
    const mediaFamily = traktItemMediaFamily(item);
    const rating = asPositiveInt(item.rating);
    if (!mediaFamily || !rating) {
      continue;
    }
    const resolved = await resolveTraktTitleIdentity(resolveIdentity, item, mediaFamily);
    if (!resolved) {
      continue;
    }
    const occurredAt = firstIsoString(item.rated_at) ?? new Date().toISOString();
    collector.importedEvents.push(buildImportedTitleEvent({
      eventType: 'rating_put',
      resolved,
      occurredAt,
      rating,
      payload: traktPayload('ratings'),
      includeShowTmdbId: true,
    }));
    collector.mediaKeysToRefresh.add(resolved.identity.mediaKey);
  }
}

async function resolveTraktPlaybackMovie(
  resolveIdentity: ResolveIdentityFn,
  item: Record<string, unknown>,
): Promise<ImportedWatchEventDraft | null> {
  const movie = getRecord(item.movie);
  const resolved = await resolveIdentity(traktLookupFromNode(movie, 'movie'));
  if (!resolved) {
    return null;
  }
  const playback = traktPlaybackSnapshot(item, movie?.runtime);
  return buildImportedTitleEvent({
    eventType: playback.eventType,
    resolved,
    occurredAt: playback.occurredAt,
    positionSeconds: playback.positionSeconds,
    durationSeconds: playback.durationSeconds,
    progressBps: playback.progressBps,
    payload: traktPlaybackPayload(item, playback.progress),
  });
}

async function resolveTraktPlaybackEpisode(
  resolveIdentity: ResolveIdentityFn,
  item: Record<string, unknown>,
): Promise<ImportedWatchEventDraft | null> {
  const show = getRecord(item.show);
  const episode = getRecord(item.episode);
  const resolvedShow = await resolveIdentity(traktLookupFromNode(show, 'show'));
  if (!resolvedShow) {
    return null;
  }
  const seasonNumber = asPositiveInt(episode?.season);
  const episodeNumber = asPositiveInt(episode?.number);
  if (!seasonNumber || !episodeNumber) {
    return null;
  }
  const identity = buildImportedEpisodeIdentity(resolvedShow, seasonNumber, episodeNumber);
  const playback = traktPlaybackSnapshot(item, episode?.runtime);
  return buildImportedEpisodeEvent({
    eventType: playback.eventType,
    identity,
    resolvedShow,
    occurredAt: playback.occurredAt,
    positionSeconds: playback.positionSeconds,
    durationSeconds: playback.durationSeconds,
    progressBps: playback.progressBps,
    payload: traktPlaybackPayload(item, playback.progress),
  });
}

export async function normalizeTraktPlayback(
  items: Array<Record<string, unknown>>,
  resolveIdentity: ResolveIdentityFn,
  collector: ImportAccumulator,
): Promise<void> {
  for (const item of items) {
    const type = asString(item.type)?.toLowerCase();
    if (type === 'movie') {
      const resolved = await resolveTraktPlaybackMovie(resolveIdentity, item);
      if (!resolved) {
        continue;
      }
      collector.importedEvents.push(resolved);
      collector.mediaKeysToRefresh.add(resolved.mediaKey);
      continue;
    }
    if (type === 'episode') {
      const resolved = await resolveTraktPlaybackEpisode(resolveIdentity, item);
      if (!resolved) {
        continue;
      }
      collector.importedEvents.push(resolved);
      collector.mediaKeysToRefresh.add(resolved.mediaKey);
    }
  }
}

export { resolveTraktTitleIdentity, traktLookupFromNode, buildImportedEpisodeIdentity, buildImportedTitleEvent, buildImportedEpisodeEvent, buildImportedTitleHistoryEntry };

export type { ResolveIdentityFn };
