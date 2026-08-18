import {
  inferMediaIdentity,
  type MediaIdentity,
} from '../../identity/media-key.js';
import {
  asArray,
  asFiniteNumber,
  asIsoString,
  asPositiveInt,
  asString,
  durationSecondsFromRuntime,
  getRecord,
} from '../provider-import.utils.js';
import type {
  ImportAccumulator,
  ImportedHistoryEntryDraft,
  ImportedWatchEventDraft,
  ResolvedImportIdentity,
} from '../provider-import.internals.js';

type SimklStatus = 'watching' | 'plantowatch' | 'hold' | 'completed' | 'dropped';

type SimklGroup = { status: SimklStatus; mediaFamily: 'movie' | 'show' | 'anime'; items: Array<Record<string, unknown>> };

type SimklResolveFn = (params: {
  mediaFamily: 'movie' | 'show' | 'anime';
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: string | null;
  kitsuId?: number | string | null;
}) => Promise<ResolvedImportIdentity | null>;

function simklPayload(source: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { provider: 'simkl', source, ...(extra ?? {}) };
}

function resolveSimklEpisodeIdentity(
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

export async function normalizeSimklMovies(
  movieLists: SimklGroup[],
  resolveIdentity: SimklResolveFn,
  collector: ImportAccumulator,
): Promise<void> {
  for (const group of movieLists) {
    for (const item of group.items) {
      const movie = getRecord(item.movie);
      const ids = getRecord(movie?.ids);
      const resolved = await resolveIdentity({
        mediaFamily: 'movie',
        tmdbId: asPositiveInt(ids?.tmdb),
        imdbId: asString(ids?.imdb),
      });
      if (!resolved) {
        continue;
      }

      const mediaKey = resolved.identity.mediaKey;
      if (group.status === 'completed') {
        const occurredAt = asIsoString(item.last_watched_at)
          ?? asIsoString(item.user_rated_at)
          ?? asIsoString(item.added_to_watchlist_at)
          ?? new Date().toISOString();
        collector.importedEvents.push({
          eventType: 'mark_watched',
          mediaKey,
          mediaType: resolved.mediaType,
          provider: resolved.identity.provider,
          providerId: resolved.identity.providerId,
          tmdbId: resolved.tmdbId,
          tvdbId: resolved.tvdbId,
          kitsuId: resolved.kitsuId,
          occurredAt,
          payload: simklPayload('all_items_completed', { status: group.status }),
        });
        collector.importedHistoryEntries.push({
          mediaKey,
          mediaType: resolved.mediaType,
          provider: resolved.identity.provider,
          providerId: resolved.identity.providerId,
          tmdbId: resolved.tmdbId,
          tvdbId: resolved.tvdbId,
          kitsuId: resolved.kitsuId,
          watchedAt: occurredAt,
          sourceKind: 'provider_import',
          payload: simklPayload('all_items_completed', { status: group.status }),
        });
      } else {
        const occurredAt = asIsoString(item.added_to_watchlist_at)
          ?? asIsoString(item.last_watched_at)
          ?? asIsoString(item.user_rated_at)
          ?? new Date().toISOString();
        collector.importedEvents.push({
          eventType: 'watchlist_put',
          mediaKey,
          mediaType: resolved.mediaType,
          provider: resolved.identity.provider,
          providerId: resolved.identity.providerId,
          tmdbId: resolved.tmdbId,
          tvdbId: resolved.tvdbId,
          kitsuId: resolved.kitsuId,
          occurredAt,
          payload: simklPayload('all_items', { status: group.status }),
        });
      }
      collector.mediaKeysToRefresh.add(mediaKey);
    }
  }
}

export async function normalizeSimklShowsAndAnime(
  groups: SimklGroup[],
  resolveIdentity: SimklResolveFn,
  collector: ImportAccumulator,
): Promise<void> {
  for (const group of groups) {
    for (const item of group.items) {
      const show = getRecord(item.show);
      const ids = getRecord(show?.ids);
      const resolvedShow = await resolveIdentity({
        mediaFamily: group.mediaFamily,
        tmdbId: asPositiveInt(ids?.tmdb),
        imdbId: asString(ids?.imdb),
        tvdbId: asString(ids?.tvdb),
        kitsuId: asPositiveInt(ids?.kitsu) ?? asString(ids?.kitsu),
      });
      if (!resolvedShow) {
        continue;
      }

      const showMediaKey = resolvedShow.identity.mediaKey;
      if (group.status !== 'completed') {
        const occurredAt = asIsoString(item.added_to_watchlist_at)
          ?? asIsoString(item.last_watched_at)
          ?? asIsoString(item.user_rated_at)
          ?? new Date().toISOString();
        collector.importedEvents.push({
          eventType: 'watchlist_put',
          mediaKey: showMediaKey,
          mediaType: resolvedShow.mediaType,
          provider: resolvedShow.identity.provider,
          providerId: resolvedShow.identity.providerId,
          tmdbId: resolvedShow.tmdbId,
          tvdbId: resolvedShow.tvdbId,
          kitsuId: resolvedShow.kitsuId,
          showTmdbId: resolvedShow.tmdbId,
          occurredAt,
          payload: simklPayload('all_items', { status: group.status }),
        });
        collector.mediaKeysToRefresh.add(showMediaKey);
      }

      for (const seasonValue of asArray(item.seasons)) {
        const season = getRecord(seasonValue);
        const defaultSeasonNumber = asPositiveInt(season?.number);
        for (const episodeValue of asArray(season?.episodes)) {
          const episode = getRecord(episodeValue);
          const mappedTvdb = getRecord(episode?.tvdb);
          const seasonNumber = asPositiveInt(mappedTvdb?.season) ?? defaultSeasonNumber;
          const episodeNumber = asPositiveInt(mappedTvdb?.episode)
            ?? asPositiveInt(episode?.tvdb_number)
            ?? asPositiveInt(episode?.number);
          if (!seasonNumber || !episodeNumber) {
            continue;
          }

          const occurredAt = asIsoString(episode?.last_watched_at)
            ?? asIsoString(episode?.watched_at)
            ?? asIsoString(item.last_watched_at)
            ?? new Date().toISOString();
          const episodeIdentity = resolveSimklEpisodeIdentity(resolvedShow, seasonNumber, episodeNumber);
          const mediaKey = episodeIdentity.mediaKey;
          collector.importedEvents.push({
            eventType: 'mark_watched',
            mediaKey,
            mediaType: 'episode',
            provider: episodeIdentity.provider,
            providerId: episodeIdentity.providerId,
            parentProvider: episodeIdentity.parentProvider,
            parentProviderId: episodeIdentity.parentProviderId,
            tmdbId: episodeIdentity.tmdbId,
            tvdbId: resolvedShow.tvdbId,
            kitsuId: resolvedShow.kitsuId,
            showTmdbId: resolvedShow.tmdbId,
            seasonNumber,
            episodeNumber,
            absoluteEpisodeNumber: episodeIdentity.absoluteEpisodeNumber,
            occurredAt,
            payload: simklPayload('all_items', { status: group.status }),
          });
          collector.importedHistoryEntries.push({
            mediaKey,
            mediaType: 'episode',
            provider: episodeIdentity.provider,
            providerId: episodeIdentity.providerId,
            parentProvider: episodeIdentity.parentProvider,
            parentProviderId: episodeIdentity.parentProviderId,
            tmdbId: episodeIdentity.tmdbId,
            tvdbId: resolvedShow.tvdbId,
            kitsuId: resolvedShow.kitsuId,
            showTmdbId: resolvedShow.tmdbId,
            seasonNumber,
            episodeNumber,
            absoluteEpisodeNumber: episodeIdentity.absoluteEpisodeNumber,
            watchedAt: occurredAt,
            sourceKind: 'provider_import',
            payload: simklPayload('all_items', { status: group.status }),
          });
          collector.mediaKeysToRefresh.add(mediaKey);
        }
      }
    }
  }
}

export async function normalizeSimklRatings(
  ratingMovies: Array<Record<string, unknown>>,
  ratingShows: Array<Record<string, unknown>>,
  ratingAnime: Array<Record<string, unknown>>,
  resolveIdentity: SimklResolveFn,
  collector: ImportAccumulator,
): Promise<void> {
  for (const [item, mediaFamily] of [
    ...ratingMovies.map((entry) => [entry, 'movie'] as const),
    ...ratingShows.map((entry) => [entry, 'show'] as const),
    ...ratingAnime.map((entry) => [entry, 'anime'] as const),
  ]) {
    const movie = getRecord(item.movie);
    const show = getRecord(item.show);
    const node = movie ?? show;
    const ids = getRecord(node?.ids);
    const resolved = await resolveIdentity({
      mediaFamily,
      tmdbId: asPositiveInt(ids?.tmdb),
      imdbId: asString(ids?.imdb),
      tvdbId: mediaFamily === 'show' ? asString(ids?.tvdb) : null,
      kitsuId: mediaFamily === 'anime' ? (asPositiveInt(ids?.kitsu) ?? asString(ids?.kitsu)) : null,
    });
    const rating = asPositiveInt(item.user_rating);
    if (!resolved || !rating) {
      continue;
    }

    const occurredAt = asIsoString(item.user_rated_at) ?? new Date().toISOString();
    const mediaKey = resolved.identity.mediaKey;
    collector.importedEvents.push({
      eventType: 'rating_put',
      mediaKey,
      mediaType: resolved.mediaType,
      provider: resolved.identity.provider,
      providerId: resolved.identity.providerId,
      tmdbId: resolved.tmdbId,
      tvdbId: resolved.tvdbId,
      kitsuId: resolved.kitsuId,
      showTmdbId: resolved.mediaType !== 'movie' ? resolved.tmdbId : null,
      rating,
      occurredAt,
      payload: simklPayload('ratings'),
    });
    collector.mediaKeysToRefresh.add(mediaKey);
  }
}

export async function normalizeSimklPlayback(
  moviePlayback: Array<Record<string, unknown>>,
  episodePlayback: Array<Record<string, unknown>>,
  resolveIdentity: SimklResolveFn,
  collector: ImportAccumulator,
): Promise<void> {
  for (const item of moviePlayback) {
    const movie = getRecord(item.movie);
    const ids = getRecord(movie?.ids);
    const resolved = await resolveIdentity({
      mediaFamily: 'movie',
      tmdbId: asPositiveInt(ids?.tmdb),
      imdbId: asString(ids?.imdb),
    });
    if (!resolved) {
      continue;
    }

    const progress = asFiniteNumber(item.progress);
    const durationSeconds = durationSecondsFromRuntime(movie?.runtime);
    const positionSeconds = progress !== null && durationSeconds !== null
      ? Math.max(1, Math.round((durationSeconds * progress) / 100))
      : null;
    const occurredAt = asIsoString(item.paused_at) ?? new Date().toISOString();
    const mediaKey = resolved.identity.mediaKey;
    collector.importedEvents.push({
      eventType: progress !== null && progress >= 90 ? 'playback_completed' : 'playback_progress_snapshot',
      mediaKey,
      mediaType: resolved.mediaType,
      provider: resolved.identity.provider,
      providerId: resolved.identity.providerId,
      tmdbId: resolved.tmdbId,
      tvdbId: resolved.tvdbId,
      kitsuId: resolved.kitsuId,
      positionSeconds,
      durationSeconds,
      occurredAt,
      payload: simklPayload('playback', { playbackId: asString(item.id), progressPercent: progress }),
    });
    collector.mediaKeysToRefresh.add(mediaKey);
  }

  for (const item of episodePlayback) {
    const show = getRecord(item.show);
    const episode = getRecord(item.episode);
    const ids = getRecord(show?.ids);
    const mediaFamily = (asPositiveInt(ids?.kitsu) || asString(ids?.kitsu)) ? 'anime' as const : 'show' as const;
    const resolvedShow = await resolveIdentity({
      mediaFamily,
      tmdbId: asPositiveInt(ids?.tmdb),
      imdbId: asString(ids?.imdb),
      tvdbId: asString(ids?.tvdb),
      kitsuId: asPositiveInt(ids?.kitsu) ?? asString(ids?.kitsu),
    });
    const seasonNumber = asPositiveInt(episode?.tvdb_season) ?? asPositiveInt(episode?.season);
    const episodeNumber = asPositiveInt(episode?.tvdb_number) ?? asPositiveInt(episode?.episode);
    if (!resolvedShow || !seasonNumber || !episodeNumber) {
      continue;
    }

    const progress = asFiniteNumber(item.progress);
    const durationSeconds = durationSecondsFromRuntime(episode?.runtime);
    const positionSeconds = progress !== null && durationSeconds !== null
      ? Math.max(1, Math.round((durationSeconds * progress) / 100))
      : null;
    const occurredAt = asIsoString(item.paused_at) ?? new Date().toISOString();
    const episodeIdentity = resolveSimklEpisodeIdentity(resolvedShow, seasonNumber, episodeNumber);
    const mediaKey = episodeIdentity.mediaKey;
    collector.importedEvents.push({
      eventType: progress !== null && progress >= 90 ? 'playback_completed' : 'playback_progress_snapshot',
      mediaKey,
      mediaType: 'episode',
      provider: episodeIdentity.provider,
      providerId: episodeIdentity.providerId,
      parentProvider: episodeIdentity.parentProvider,
      parentProviderId: episodeIdentity.parentProviderId,
      tmdbId: episodeIdentity.tmdbId,
      tvdbId: resolvedShow.tvdbId,
      kitsuId: resolvedShow.kitsuId,
      showTmdbId: resolvedShow.tmdbId,
      seasonNumber,
      episodeNumber,
      absoluteEpisodeNumber: episodeIdentity.absoluteEpisodeNumber,
      positionSeconds,
      durationSeconds,
      occurredAt,
      payload: simklPayload('playback', { playbackId: asString(item.id), progressPercent: progress }),
    });
    collector.mediaKeysToRefresh.add(mediaKey);
  }
}

export type { SimklResolveFn, SimklGroup, SimklStatus };
