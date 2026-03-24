import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { MetadataDirectService } from '../metadata/metadata-direct.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { ProfileWatchDataStateRepository } from '../imports/profile-watch-data-state.repo.js';
import { ProviderImportConnectionsRepository } from '../imports/provider-import-connections.repo.js';
import { ProviderTokenAccessService } from '../imports/provider-token-access.service.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchHistoryQueryService } from '../watch/history.service.js';
import { WatchCollectionService } from '../watch/watch-collection.service.js';
import type {
  LibraryProviderSource,
  ProfileLibraryResponse,
  ProviderAuthStateView,
  ProviderLibraryFolderView,
  ProviderLibraryItemView,
  ProviderLibrarySnapshotView,
} from './library.types.js';

type ProviderKey = 'trakt' | 'simkl';

export class LibraryService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly watchDataStateRepository = new ProfileWatchDataStateRepository(),
    private readonly connectionsRepository = new ProviderImportConnectionsRepository(),
    private readonly providerTokenAccessService = new ProviderTokenAccessService(),
    private readonly continueWatchingService = new ContinueWatchingService(),
    private readonly historyService = new WatchHistoryQueryService(),
    private readonly watchCollectionService = new WatchCollectionService(),
    private readonly metadataDirectService = new MetadataDirectService(),
  ) {}

  async getProfileLibrary(
    userId: string,
    profileId: string,
    options?: { source?: LibraryProviderSource | null; limitPerFolder?: number | null },
  ): Promise<ProfileLibraryResponse> {
    const source = normalizeSource(options?.source);
    const limitPerFolder = clampLimit(options?.limitPerFolder ?? 100, 1, 250);

    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
    });

    const [auth, native, providers] = await Promise.all([
      this.getProviderAuthState(profileId),
      source === 'local' || source === 'all' ? this.getNativeLibrary(userId, profileId) : Promise.resolve(null),
      this.getProviderLibraries(profileId, source, limitPerFolder),
    ]);

    return {
      profileId,
      source,
      auth: {
        providers: auth,
      },
      native,
      providers,
    };
  }

  async requireOwnedProfile(userId: string, profileId: string): Promise<void> {
    await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
    });
  }

  async getProviderAuthState(profileId: string): Promise<ProviderAuthStateView[]> {
    return withTransaction(async (client) => {
      const [watchDataState, connections] = await Promise.all([
        this.watchDataStateRepository.getForProfile(client, profileId),
        this.connectionsRepository.listForProfile(client, profileId),
      ]);

      const latestByProvider = new Map<ProviderKey, (typeof connections)[number]>();
      for (const connection of connections) {
        if (connection.provider === 'trakt' || connection.provider === 'simkl') {
          if (!latestByProvider.has(connection.provider)) {
            latestByProvider.set(connection.provider, connection);
          }
        }
      }

      const providers: ProviderKey[] = ['trakt', 'simkl'];
      return Promise.all(providers.map(async (provider) => {
        const connection = latestByProvider.get(provider) ?? null;
        if (!connection || connection.status !== 'connected') {
          return {
            provider,
            connected: false,
            status: 'disconnected',
            tokenState: null,
            externalUsername: connection?.externalUsername ?? null,
            lastImportCompletedAt: watchDataState?.lastImportProvider === provider ? watchDataState.lastImportCompletedAt : null,
            lastUsedAt: connection?.lastUsedAt ?? null,
            message: `Connect ${providerLabel(provider)} to load provider library.`,
          } satisfies ProviderAuthStateView;
        }

        try {
          const tokenStatus = await this.providerTokenAccessService.getTokenStatus(profileId, provider);
          return {
            provider,
            connected: true,
            status: 'connected',
            tokenState: tokenStatus.tokenState,
            externalUsername: connection.externalUsername,
            lastImportCompletedAt: watchDataState?.lastImportProvider === provider ? watchDataState.lastImportCompletedAt : null,
            lastUsedAt: connection.lastUsedAt,
            message: null,
          } satisfies ProviderAuthStateView;
        } catch (error) {
          return {
            provider,
            connected: true,
            status: 'error',
            tokenState: null,
            externalUsername: connection.externalUsername,
            lastImportCompletedAt: watchDataState?.lastImportProvider === provider ? watchDataState.lastImportCompletedAt : null,
            lastUsedAt: connection.lastUsedAt,
            message: error instanceof Error ? error.message : `${providerLabel(provider)} token unavailable.`,
          } satisfies ProviderAuthStateView;
        }
      }));
    });
  }

  private async getNativeLibrary(userId: string, profileId: string) {
    const [continueWatching, history, watchlist, ratings] = await Promise.all([
      this.continueWatchingService.list(userId, profileId, 50),
      this.historyService.list(userId, profileId, 100),
      this.watchCollectionService.listWatchlist(userId, profileId, 100),
      this.watchCollectionService.listRatings(userId, profileId, 100),
    ]);

    return {
      continueWatching,
      history,
      watchlist,
      ratings,
    };
  }

  private async getProviderLibraries(
    profileId: string,
    source: LibraryProviderSource,
    limitPerFolder: number,
  ): Promise<ProviderLibrarySnapshotView[]> {
    const providers = source === 'all'
      ? (['trakt', 'simkl'] as const)
      : source === 'trakt' || source === 'simkl'
        ? ([source] as const)
        : ([] as const);

    return Promise.all(providers.map((provider) => this.getProviderLibrary(profileId, provider, limitPerFolder)));
  }

  private async getProviderLibrary(
    profileId: string,
    provider: ProviderKey,
    limitPerFolder: number,
  ): Promise<ProviderLibrarySnapshotView> {
    try {
      const accessTokenView = await this.providerTokenAccessService.getAccessToken(profileId, provider);
      const accessToken = accessTokenView.accessToken;

      if (provider === 'trakt') {
        return this.fetchTraktLibrary(profileId, accessToken, limitPerFolder);
      }
      return this.fetchSimklLibrary(profileId, accessToken, limitPerFolder);
    } catch (error) {
      return {
        provider,
        status: 'disconnected',
        statusMessage: error instanceof Error ? error.message : `Unable to load ${providerLabel(provider)} library.`,
        folders: [],
        items: [],
      };
    }
  }

  private async fetchTraktLibrary(
    _profileId: string,
    accessToken: string,
    limitPerFolder: number,
  ): Promise<ProviderLibrarySnapshotView> {
    const [playback, watchedMovies, watchedShows, watchlistMovies, watchlistShows, collectionMovies, collectionShows, ratingMovies, ratingShows] = await Promise.all([
      traktGetArray('/sync/playback', accessToken),
      traktGetArray('/sync/watched/movies?extended=images', accessToken),
      traktGetArray('/sync/watched/shows?extended=images', accessToken),
      traktGetArray('/sync/watchlist/movies?extended=images', accessToken),
      traktGetArray('/sync/watchlist/shows?extended=images', accessToken),
      traktGetArray('/sync/collection/movies?extended=images', accessToken),
      traktGetArray('/sync/collection/shows?extended=images', accessToken),
      traktGetArray('/sync/ratings/movies?extended=images', accessToken),
      traktGetArray('/sync/ratings/shows?extended=images', accessToken),
    ]);

    const folderItems = new Map<string, ProviderLibraryItemView[]>();
    folderItems.set('continue-watching', await this.mapTraktPlaybackItems(playback, limitPerFolder));
    folderItems.set('watched', [
      ...mapTraktWatchedItems(watchedMovies, 'movie', 'watched'),
      ...mapTraktWatchedItems(watchedShows, 'show', 'watched'),
    ].slice(0, limitPerFolder));
    folderItems.set('watchlist', [
      ...mapTraktListItems(watchlistMovies, 'movie', 'watchlist'),
      ...mapTraktListItems(watchlistShows, 'show', 'watchlist'),
    ].slice(0, limitPerFolder));
    folderItems.set('collection', [
      ...mapTraktListItems(collectionMovies, 'movie', 'collection'),
      ...mapTraktListItems(collectionShows, 'show', 'collection'),
    ].slice(0, limitPerFolder));
    folderItems.set('ratings', [
      ...mapTraktListItems(ratingMovies, 'movie', 'ratings'),
      ...mapTraktListItems(ratingShows, 'show', 'ratings'),
    ].slice(0, limitPerFolder));

    return this.finalizeProviderSnapshot('trakt', folderItems, '');
  }

  private async fetchSimklLibrary(
    _profileId: string,
    accessToken: string,
    limitPerFolder: number,
  ): Promise<ProviderLibrarySnapshotView> {
    const statuses = ['watching', 'plantowatch', 'completed', 'hold', 'dropped'] as const;
    const [moviePlayback, episodePlayback, ratingMovies, ratingShows, ratingAnime, ...listResponses] = await Promise.all([
      simklGetArray('/sync/playback/movies', accessToken),
      simklGetArray('/sync/playback/episodes', accessToken),
      simklGetArray('/sync/ratings/movies', accessToken, undefined, 'movies'),
      simklGetArray('/sync/ratings/shows', accessToken, undefined, 'shows'),
      simklGetArray('/sync/ratings/anime', accessToken, undefined, 'anime'),
      ...statuses.flatMap((status) => [
        simklGetArray(`/sync/all-items/movies/${status}`, accessToken, { extended: 'full' }, 'movies'),
        simklGetArray(`/sync/all-items/shows/${status}`, accessToken, { extended: 'full', episode_watched_at: 'yes' }, 'shows'),
        simklGetArray(`/sync/all-items/anime/${status}`, accessToken, { extended: 'full_anime_seasons' }, 'anime'),
      ]),
    ]);

    const folderItems = new Map<string, ProviderLibraryItemView[]>();
    folderItems.set('continue-watching', [
      ...mapSimklPlaybackItems(moviePlayback, 'movie', 'continue-watching'),
      ...mapSimklPlaybackItems(episodePlayback, 'show', 'continue-watching'),
    ].slice(0, limitPerFolder));

    let responseIndex = 0;
    for (const status of statuses) {
      folderItems.set(`${status}-movies`, mapSimklAllItems(listResponses[responseIndex++] ?? [], 'movie', `${status}-movies`).slice(0, limitPerFolder));
      folderItems.set(`${status}-shows`, mapSimklAllItems(listResponses[responseIndex++] ?? [], 'show', `${status}-shows`).slice(0, limitPerFolder));
      folderItems.set(`${status}-anime`, mapSimklAllItems(listResponses[responseIndex++] ?? [], 'show', `${status}-anime`).slice(0, limitPerFolder));
    }

    folderItems.set('ratings', mapSimklRatingsItems([...ratingMovies, ...ratingShows, ...ratingAnime]).slice(0, limitPerFolder));
    return this.finalizeProviderSnapshot('simkl', folderItems, '');
  }

  private async mapTraktPlaybackItems(items: Array<Record<string, unknown>>, limitPerFolder: number): Promise<ProviderLibraryItemView[]> {
    const mapped: ProviderLibraryItemView[] = [];
    for (const item of items) {
      const type = asString(item.type)?.toLowerCase();
      if (type === 'movie') {
        const movie = asRecord(item.movie);
        const media = movie ? await this.safeResolveMetadata({
          tmdbId: asPositiveInt(asRecord(movie.ids)?.tmdb),
          imdbId: asString(asRecord(movie.ids)?.imdb),
          mediaType: 'movie',
        }) : null;
        const contentId = media?.externalIds.imdb ?? media?.id ?? '';
        if (!contentId) {
          continue;
        }
        mapped.push({
          provider: 'trakt',
          folderId: 'continue-watching',
          contentId,
          contentType: 'movie',
          title: asString(movie?.title) ?? media?.title ?? contentId,
          posterUrl: traktPosterUrl(asRecord(movie?.images)) ?? media?.artwork.posterUrl ?? null,
          backdropUrl: traktBackdropUrl(asRecord(movie?.images)) ?? media?.artwork.backdropUrl ?? null,
          seasonNumber: null,
          episodeNumber: null,
          addedAt: asIsoString(item.paused_at) ?? new Date().toISOString(),
          media,
        });
        continue;
      }

      if (type === 'episode') {
        const show = asRecord(item.show);
        const episode = asRecord(item.episode);
        const seasonNumber = asPositiveInt(episode?.season);
        const episodeNumber = asPositiveInt(episode?.number);
        if (!show || !seasonNumber || !episodeNumber) {
          continue;
        }

        const media = await this.safeResolveMetadata({
          tmdbId: asPositiveInt(asRecord(show.ids)?.tmdb),
          imdbId: asString(asRecord(show.ids)?.imdb),
          tvdbId: asPositiveInt(asRecord(show.ids)?.tvdb),
          mediaType: 'episode',
          seasonNumber,
          episodeNumber,
        });
        const contentId = media?.externalIds.imdb ?? media?.id ?? '';
        if (!contentId) {
          continue;
        }
        mapped.push({
          provider: 'trakt',
          folderId: 'continue-watching',
          contentId,
          contentType: 'show',
          title: asString(show.title) ?? media?.title ?? contentId,
          posterUrl: traktPosterUrl(asRecord(show.images)) ?? media?.artwork.posterUrl ?? null,
          backdropUrl: traktBackdropUrl(asRecord(show.images)) ?? media?.artwork.backdropUrl ?? null,
          seasonNumber,
          episodeNumber,
          addedAt: asIsoString(item.paused_at) ?? new Date().toISOString(),
          media,
        });
      }
    }

    return mapped.slice(0, limitPerFolder);
  }

  private async safeResolveMetadata(params: {
    tmdbId?: number | null;
    imdbId?: string | null;
    tvdbId?: number | null;
    mediaType: 'movie' | 'show' | 'episode';
    seasonNumber?: number | null;
    episodeNumber?: number | null;
  }) {
    try {
      return await this.metadataDirectService.resolveMetadataView({
        tmdbId: params.tmdbId ?? null,
        imdbId: params.imdbId ?? null,
        tvdbId: params.tvdbId ?? null,
        mediaType: params.mediaType,
        seasonNumber: params.seasonNumber ?? null,
        episodeNumber: params.episodeNumber ?? null,
      });
    } catch {
      return null;
    }
  }

  private finalizeProviderSnapshot(
    provider: ProviderKey,
    folderItems: Map<string, ProviderLibraryItemView[]>,
    statusMessage: string,
  ): ProviderLibrarySnapshotView {
    const folders: ProviderLibraryFolderView[] = [];
    const items: ProviderLibraryItemView[] = [];

    for (const [folderId, values] of folderItems.entries()) {
      if (!values.length) {
        continue;
      }
      folders.push({
        id: folderId,
        label: provider === 'trakt' ? titleCase(folderId.replace(/-/g, ' ')) : simklFolderLabel(folderId),
        provider,
        itemCount: values.length,
      });
      items.push(...values);
    }

    return {
      provider,
      status: 'connected',
      statusMessage,
      folders,
      items,
    };
  }
}

function normalizeSource(source: LibraryProviderSource | null | undefined): LibraryProviderSource {
  if (source === 'local' || source === 'trakt' || source === 'simkl' || source === 'all') {
    return source;
  }
  return 'all';
}

function providerLabel(provider: ProviderKey): string {
  return provider === 'trakt' ? 'Trakt' : 'Simkl';
}

function clampLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function traktGetArray(path: string, accessToken: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`https://api.trakt.tv${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'trakt-api-key': env.traktImportClientId,
      'trakt-api-version': '2',
      'User-Agent': 'CrispyServer/1.0',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !Array.isArray(payload)) {
    throw new HttpError(response.status || 502, `Trakt library request failed for ${path}.`);
  }
  return payload.filter(isRecord);
}

async function simklGetArray(
  path: string,
  accessToken: string,
  query?: Record<string, string>,
  collectionKey?: string,
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(`https://api.simkl.com${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'simkl-api-key': env.simklImportClientId,
    },
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const records = extractProviderArray(payload, collectionKey);
  if (!response.ok || records === null) {
    throw new HttpError(response.status || 502, `Simkl library request failed for ${path}.`);
  }
  return records;
}

function extractProviderArray(payload: unknown, collectionKey?: string): Array<Record<string, unknown>> | null {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (isRecord(payload) && collectionKey && Array.isArray(payload[collectionKey])) {
    return (payload[collectionKey] as unknown[]).filter(isRecord);
  }
  return null;
}

function mapTraktWatchedItems(
  items: Array<Record<string, unknown>>,
  type: 'movie' | 'show',
  folderId: string,
): ProviderLibraryItemView[] {
  return items.flatMap((item) => {
    const node = asRecord(type === 'movie' ? item.movie : item.show);
    const contentId = normalizedProviderContentId(asRecord(node?.ids));
    if (!node || !contentId) {
      return [];
    }
    return [{
      provider: 'trakt',
      folderId,
      contentId,
      contentType: type === 'movie' ? 'movie' : 'show',
      title: asString(node.title) ?? contentId,
      posterUrl: traktPosterUrl(asRecord(node.images)),
      backdropUrl: traktBackdropUrl(asRecord(node.images)),
      seasonNumber: null,
      episodeNumber: null,
      addedAt: asIsoString(item.last_watched_at) ?? new Date().toISOString(),
      media: null,
    }];
  });
}

function mapTraktListItems(
  items: Array<Record<string, unknown>>,
  type: 'movie' | 'show',
  folderId: string,
): ProviderLibraryItemView[] {
  return items.flatMap((item) => {
    const node = asRecord(type === 'movie' ? item.movie : item.show);
    const contentId = normalizedProviderContentId(asRecord(node?.ids));
    if (!node || !contentId) {
      return [];
    }
    return [{
      provider: 'trakt',
      folderId,
      contentId,
      contentType: type === 'movie' ? 'movie' : 'show',
      title: asString(node.title) ?? contentId,
      posterUrl: traktPosterUrl(asRecord(node.images)),
      backdropUrl: traktBackdropUrl(asRecord(node.images)),
      seasonNumber: null,
      episodeNumber: null,
      addedAt: asIsoString(item.listed_at) ?? asIsoString(item.rated_at) ?? asIsoString(item.collected_at) ?? new Date().toISOString(),
      media: null,
    }];
  });
}

function mapSimklPlaybackItems(
  items: Array<Record<string, unknown>>,
  contentType: 'movie' | 'show',
  folderId: string,
): ProviderLibraryItemView[] {
  return items.flatMap((item) => {
    const content = asRecord(item.movie) ?? asRecord(item.show) ?? item;
    const contentId = normalizedProviderContentId(asRecord(content.ids));
    if (!content || !contentId) {
      return [];
    }
    const episode = asRecord(item.episode);
    return [{
      provider: 'simkl',
      folderId,
      contentId,
      contentType,
      title: asString(content.title) ?? contentId,
      posterUrl: asString(content.poster),
      backdropUrl: asString(content.fanart),
      seasonNumber: asPositiveInt(episode?.season) ?? asPositiveInt(episode?.tvdb_season),
      episodeNumber: asPositiveInt(episode?.episode) ?? asPositiveInt(episode?.number) ?? asPositiveInt(episode?.tvdb_number),
      addedAt: asIsoString(item.paused_at) ?? new Date().toISOString(),
      media: null,
    }];
  });
}

function mapSimklAllItems(
  items: Array<Record<string, unknown>>,
  contentType: 'movie' | 'show',
  folderId: string,
): ProviderLibraryItemView[] {
  return items.flatMap((wrapper) => {
    const content = asRecord(wrapper.movie) ?? asRecord(wrapper.show) ?? asRecord(wrapper.anime) ?? wrapper;
    const contentId = normalizedProviderContentId(asRecord(content.ids) ?? asRecord(wrapper.ids));
    if (!content || !contentId) {
      return [];
    }
    return [{
      provider: 'simkl',
      folderId,
      contentId,
      contentType,
      title: asString(content.title) ?? contentId,
      posterUrl: asString(content.poster),
      backdropUrl: asString(content.fanart),
      seasonNumber: null,
      episodeNumber: null,
      addedAt: asIsoString(wrapper.last_watched_at) ?? asIsoString(wrapper.added_to_watchlist_at) ?? asIsoString(wrapper.rated_at) ?? new Date().toISOString(),
      media: null,
    }];
  });
}

function mapSimklRatingsItems(items: Array<Record<string, unknown>>): ProviderLibraryItemView[] {
  return items.flatMap((wrapper) => {
    const content = asRecord(wrapper.movie) ?? asRecord(wrapper.show) ?? asRecord(wrapper.anime) ?? wrapper;
    const contentId = normalizedProviderContentId(asRecord(content.ids) ?? asRecord(wrapper.ids));
    if (!content || !contentId) {
      return [];
    }
    return [{
      provider: 'simkl',
      folderId: 'ratings',
      contentId,
      contentType: wrapper.movie ? 'movie' : 'show',
      title: asString(content.title) ?? contentId,
      posterUrl: asString(content.poster),
      backdropUrl: asString(content.fanart),
      seasonNumber: null,
      episodeNumber: null,
      addedAt: asIsoString(wrapper.rated_at) ?? new Date().toISOString(),
      media: null,
    }];
  });
}

function normalizedProviderContentId(ids: Record<string, unknown> | null): string | null {
  const imdb = normalizeImdbId(asString(ids?.imdb));
  if (imdb) {
    return imdb;
  }
  const tmdb = asPositiveInt(ids?.tmdb);
  return tmdb ? `tmdb:${tmdb}` : null;
}

function traktPosterUrl(images: Record<string, unknown> | null): string | null {
  return traktExtractImageUrl(images, 'poster') ?? traktExtractImageUrl(images, 'thumb');
}

function traktBackdropUrl(images: Record<string, unknown> | null): string | null {
  return traktExtractImageUrl(images, 'fanart') ?? traktExtractImageUrl(images, 'background') ?? traktExtractImageUrl(images, 'banner');
}

function traktExtractImageUrl(images: Record<string, unknown> | null, key: string): string | null {
  const values = Array.isArray(images?.[key]) ? images[key] as unknown[] : [];
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return normalizeImageUrl(value);
    }
    if (isRecord(value)) {
      const candidate = asString(value.full) ?? asString(value.medium) ?? asString(value.thumb);
      if (candidate) {
        return normalizeImageUrl(candidate);
      }
    }
  }
  return null;
}

function normalizeImageUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('http://')) {
    return `https://${trimmed.slice('http://'.length)}`;
  }
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  if (trimmed.includes('://') || trimmed.startsWith('/')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function simklFolderLabel(folderId: string): string {
  if (folderId === 'continue-watching') {
    return 'Continue Watching';
  }
  if (folderId === 'ratings') {
    return 'Ratings';
  }
  return titleCase(folderId.replace(/-/g, ' '));
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeImdbId(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith('tt')) {
    return value;
  }
  return /^\d+$/.test(value) ? `tt${value}` : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asIsoString(value: unknown): string | null {
  const text = asString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function asPositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
