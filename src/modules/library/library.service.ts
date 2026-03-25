import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { MetadataDirectService } from '../metadata/metadata-direct.service.js';
import type { MetadataView } from '../metadata/tmdb.types.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { ProfileWatchDataStateRepository } from '../imports/profile-watch-data-state.repo.js';
import { ProviderImportConnectionsRepository } from '../imports/provider-import-connections.repo.js';
import { ProviderTokenAccessService } from '../imports/provider-token-access.service.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchHistoryQueryService } from '../watch/history.service.js';
import { WatchCollectionService } from '../watch/watch-collection.service.js';
import type {
  LibraryMutationResponse,
  LibraryMutationSource,
  LibraryProviderSource,
  ProfileLibraryResponse,
  ProviderAuthStateView,
  ProviderLibraryFolderView,
  ProviderLibraryItemView,
  ProviderLibrarySnapshotView,
  ProviderMutationResultView,
} from './library.types.js';

type ProviderKey = 'trakt' | 'simkl';

type ResolveInput = {
  id?: string;
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  mediaType?: 'movie' | 'show' | 'episode' | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

type ProviderMutationTarget = {
  media: MetadataView;
  mediaType: 'movie' | 'show';
  tmdbId: number | null;
  imdbId: string | null;
};

type MappedProviderItem = ProviderLibraryItemView & {
  resolveInput: ResolveInput | null;
};

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

    await this.requireOwnedProfile(userId, profileId);

    const [auth, native, providers] = await Promise.all([
      this.getProviderAuthState(userId, profileId),
      source === 'local' || source === 'all' ? this.getNativeLibrary(userId, profileId) : Promise.resolve(null),
      this.getProviderLibraries(userId, profileId, source, limitPerFolder),
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
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
    });
  }

  async getProviderAuthState(accountId: string, profileId: string): Promise<ProviderAuthStateView[]> {
    return withTransaction(async (client) => {
      const [watchDataState, connections] = await Promise.all([
        this.watchDataStateRepository.getForProfile(client, profileId),
        this.connectionsRepository.listForProfile(client, profileId),
      ]);

      const latestByProvider = new Map<ProviderKey, (typeof connections)[number]>();
      for (const connection of connections) {
        if ((connection.provider === 'trakt' || connection.provider === 'simkl') && !latestByProvider.has(connection.provider)) {
          latestByProvider.set(connection.provider, connection);
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
          const tokenStatus = await this.providerTokenAccessService.getTokenStatusForAccountProfile(accountId, profileId, provider);
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

  async setWatchlist(
    userId: string,
    profileId: string,
    input: ResolveInput & { source?: LibraryMutationSource | null; inWatchlist: boolean },
  ): Promise<LibraryMutationResponse> {
    await this.requireOwnedProfile(userId, profileId);
    const source = normalizeMutationSource(input.source);
    const target = await this.resolveMutationTarget(input);
    const providers = providersForMutationSource(source);
    const results = await Promise.all(providers.map((provider) => this.mutateWatchlistForProvider(userId, profileId, provider, target, input.inWatchlist)));

    return {
      source,
      action: 'watchlist',
      media: target.media,
      watchlist: input.inWatchlist,
      rating: null,
      results,
      statusMessage: buildWatchlistStatusMessage(input.inWatchlist, results),
    };
  }

  async setRating(
    userId: string,
    profileId: string,
    input: ResolveInput & { source?: LibraryMutationSource | null; rating: number | null },
  ): Promise<LibraryMutationResponse> {
    await this.requireOwnedProfile(userId, profileId);
    const source = normalizeMutationSource(input.source);
    const rating = input.rating === null ? null : clampLimit(input.rating, 1, 10);
    const target = await this.resolveMutationTarget(input);
    const providers = providersForMutationSource(source);
    const results = await Promise.all(providers.map((provider) => this.mutateRatingForProvider(userId, profileId, provider, target, rating)));

    return {
      source,
      action: 'rating',
      media: target.media,
      watchlist: null,
      rating,
      results,
      statusMessage: buildRatingStatusMessage(rating, results),
    };
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
    accountId: string,
    profileId: string,
    source: LibraryProviderSource,
    limitPerFolder: number,
  ): Promise<ProviderLibrarySnapshotView[]> {
    const providers = source === 'all'
      ? (['trakt', 'simkl'] as const)
      : source === 'trakt' || source === 'simkl'
        ? ([source] as const)
        : ([] as const);

    return Promise.all(providers.map((provider) => this.getProviderLibrary(accountId, profileId, provider, limitPerFolder)));
  }

  private async getProviderLibrary(
    accountId: string,
    profileId: string,
    provider: ProviderKey,
    limitPerFolder: number,
  ): Promise<ProviderLibrarySnapshotView> {
    try {
      const accessTokenView = await this.providerTokenAccessService.getAccessTokenForAccountProfile(accountId, profileId, provider);
      const accessToken = accessTokenView.accessToken;

      if (provider === 'trakt') {
        return this.fetchTraktLibrary(accessToken, limitPerFolder);
      }
      return this.fetchSimklLibrary(accessToken, limitPerFolder);
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

    const folderItems = new Map<string, MappedProviderItem[]>();
    folderItems.set('continue-watching', await this.hydrateProviderItems(mapTraktPlaybackItems(playback, 'continue-watching')).then((items) => items.slice(0, limitPerFolder)));
    folderItems.set('watched', await this.hydrateProviderItems([
      ...mapTraktWatchedItems(watchedMovies, 'movie', 'watched'),
      ...mapTraktWatchedItems(watchedShows, 'show', 'watched'),
    ]).then((items) => items.slice(0, limitPerFolder)));
    folderItems.set('watchlist', await this.hydrateProviderItems([
      ...mapTraktListItems(watchlistMovies, 'movie', 'watchlist', 'listed_at'),
      ...mapTraktListItems(watchlistShows, 'show', 'watchlist', 'listed_at'),
    ]).then((items) => items.slice(0, limitPerFolder)));
    folderItems.set('collection', await this.hydrateProviderItems([
      ...mapTraktListItems(collectionMovies, 'movie', 'collection', 'collected_at'),
      ...mapTraktListItems(collectionShows, 'show', 'collection', 'collected_at'),
    ]).then((items) => items.slice(0, limitPerFolder)));
    folderItems.set('ratings', await this.hydrateProviderItems([
      ...mapTraktListItems(ratingMovies, 'movie', 'ratings', 'rated_at'),
      ...mapTraktListItems(ratingShows, 'show', 'ratings', 'rated_at'),
    ]).then((items) => items.slice(0, limitPerFolder)));

    return this.finalizeProviderSnapshot('trakt', folderItems, '');
  }

  private async fetchSimklLibrary(
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

    const folderItems = new Map<string, MappedProviderItem[]>();
    folderItems.set('continue-watching', await this.hydrateProviderItems([
      ...mapSimklPlaybackItems(moviePlayback, 'movie', 'continue-watching'),
      ...mapSimklPlaybackItems(episodePlayback, 'show', 'continue-watching'),
    ]).then((items) => items.slice(0, limitPerFolder)));

    let responseIndex = 0;
    for (const status of statuses) {
      folderItems.set(
        `${status}-movies`,
        await this.hydrateProviderItems(mapSimklAllItems(listResponses[responseIndex++] ?? [], 'movie', `${status}-movies`)).then((items) => items.slice(0, limitPerFolder)),
      );
      folderItems.set(
        `${status}-shows`,
        await this.hydrateProviderItems(mapSimklAllItems(listResponses[responseIndex++] ?? [], 'show', `${status}-shows`)).then((items) => items.slice(0, limitPerFolder)),
      );
      folderItems.set(
        `${status}-anime`,
        await this.hydrateProviderItems(mapSimklAllItems(listResponses[responseIndex++] ?? [], 'show', `${status}-anime`)).then((items) => items.slice(0, limitPerFolder)),
      );
    }

    folderItems.set(
      'ratings',
      await this.hydrateProviderItems(mapSimklRatingsItems([...ratingMovies, ...ratingShows, ...ratingAnime])).then((items) => items.slice(0, limitPerFolder)),
    );

    return this.finalizeProviderSnapshot('simkl', folderItems, '');
  }

  private async hydrateProviderItems(items: MappedProviderItem[]): Promise<MappedProviderItem[]> {
    const cache = new Map<string, MetadataView | null>();
    const keys = items
      .map((item) => item.resolveInput ? resolveCacheKey(item.resolveInput) : null)
      .filter((value): value is string => value !== null);

    await Promise.all(Array.from(new Set(keys)).map(async (key) => {
      const input = parseResolveCacheKey(key);
      cache.set(key, await this.safeResolveMetadata(input));
    }));

    return items.map((item) => {
      const media = item.resolveInput ? cache.get(resolveCacheKey(item.resolveInput)) ?? null : null;
      return {
        ...item,
        contentId: media?.externalIds.imdb ?? item.contentId,
        title: item.title || media?.title || item.contentId,
        posterUrl: item.posterUrl ?? media?.artwork.posterUrl ?? null,
        backdropUrl: item.backdropUrl ?? media?.artwork.backdropUrl ?? null,
        media,
      };
    });
  }

  private async resolveMutationTarget(input: ResolveInput): Promise<ProviderMutationTarget> {
    const playback = await this.metadataDirectService.resolvePlayback(input);
    const media = playback.item.mediaType === 'episode' ? playback.show : playback.item;
    if (!media) {
      throw new HttpError(404, 'Metadata not found for library mutation.');
    }
    if (media.mediaType !== 'movie' && media.mediaType !== 'show') {
      throw new HttpError(400, 'Library mutations only support movies and shows.');
    }

    return {
      media,
      mediaType: media.mediaType,
      tmdbId: media.tmdbId,
      imdbId: normalizeImdbId(media.externalIds.imdb),
    };
  }

  private async mutateWatchlistForProvider(
    accountId: string,
    profileId: string,
    provider: ProviderKey,
    target: ProviderMutationTarget,
    inWatchlist: boolean,
  ): Promise<ProviderMutationResultView> {
    try {
      const { accessToken } = await this.providerTokenAccessService.getAccessTokenForAccountProfile(accountId, profileId, provider);

      if (provider === 'trakt') {
        const ok = await traktSetWatchlist(accessToken, target, inWatchlist);
        return {
          provider,
          status: ok ? 'success' : 'error',
          message: ok ? null : 'Trakt watchlist sync failed.',
        };
      }

      if (!target.imdbId) {
        return {
          provider,
          status: 'skipped',
          message: 'Simkl watchlist sync requires an IMDb id.',
        };
      }

      const ok = inWatchlist
        ? await simklAddToList(accessToken, target, 'plantowatch')
        : await simklRemoveFromList(accessToken, target);
      return {
        provider,
        status: ok ? 'success' : 'error',
        message: ok ? null : 'Simkl watchlist sync failed.',
      };
    } catch (error) {
      return {
        provider,
        status: 'error',
        message: error instanceof Error ? error.message : `${providerLabel(provider)} watchlist sync failed.`,
      };
    }
  }

  private async mutateRatingForProvider(
    accountId: string,
    profileId: string,
    provider: ProviderKey,
    target: ProviderMutationTarget,
    rating: number | null,
  ): Promise<ProviderMutationResultView> {
    try {
      const { accessToken } = await this.providerTokenAccessService.getAccessTokenForAccountProfile(accountId, profileId, provider);

      if (provider === 'trakt') {
        const ok = await traktSetRating(accessToken, target, rating);
        return {
          provider,
          status: ok ? 'success' : 'error',
          message: ok ? null : 'Trakt rating sync failed.',
        };
      }

      if (!target.imdbId) {
        return {
          provider,
          status: 'skipped',
          message: 'Simkl rating sync requires an IMDb id.',
        };
      }
      if (rating === null) {
        return {
          provider,
          status: 'skipped',
          message: 'Removing ratings is not supported for Simkl.',
        };
      }

      const ok = await simklAddRating(accessToken, target, rating);
      return {
        provider,
        status: ok ? 'success' : 'error',
        message: ok ? null : 'Simkl rating sync failed.',
      };
    } catch (error) {
      return {
        provider,
        status: 'error',
        message: error instanceof Error ? error.message : `${providerLabel(provider)} rating sync failed.`,
      };
    }
  }

  private async safeResolveMetadata(input: ResolveInput): Promise<MetadataView | null> {
    try {
      return await this.metadataDirectService.resolveMetadataView({
        id: input.id,
        tmdbId: input.tmdbId ?? null,
        imdbId: input.imdbId ?? null,
        tvdbId: input.tvdbId ?? null,
        mediaType: input.mediaType ?? null,
        seasonNumber: input.seasonNumber ?? null,
        episodeNumber: input.episodeNumber ?? null,
      });
    } catch {
      return null;
    }
  }

  private finalizeProviderSnapshot(
    provider: ProviderKey,
    folderItems: Map<string, MappedProviderItem[]>,
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

      items.push(...values.map(({ resolveInput: _resolveInput, ...item }) => item));
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

function normalizeMutationSource(source: LibraryMutationSource | null | undefined): LibraryMutationSource {
  if (source === 'trakt' || source === 'simkl' || source === 'all') {
    return source;
  }
  return 'all';
}

function providersForMutationSource(source: LibraryMutationSource): ProviderKey[] {
  return source === 'all' ? ['trakt', 'simkl'] : [source];
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
    headers: traktHeaders(accessToken),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !Array.isArray(payload)) {
    throw new HttpError(response.status || 502, `Trakt library request failed for ${path}.`);
  }
  return payload.filter(isRecord);
}

async function traktPost(path: string, accessToken: string, payload: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(`https://api.trakt.tv${path}`, {
    method: 'POST',
    headers: traktHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (response.ok || response.status === 409) {
    return true;
  }
  throw new HttpError(response.status || 502, `Trakt request failed for ${path}.`);
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
    headers: simklHeaders(accessToken),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const records = extractProviderArray(payload, collectionKey);
  if (!response.ok || records === null) {
    throw new HttpError(response.status || 502, `Simkl library request failed for ${path}.`);
  }
  return records;
}

async function simklPost(path: string, accessToken: string, payload: Record<string, unknown>): Promise<boolean> {
  const response = await fetch(`https://api.simkl.com${path}`, {
    method: 'POST',
    headers: simklHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  if (response.ok || response.status === 409) {
    return true;
  }
  throw new HttpError(response.status || 502, `Simkl request failed for ${path}.`);
}

async function traktSetWatchlist(accessToken: string, target: ProviderMutationTarget, inWatchlist: boolean): Promise<boolean> {
  const ids = traktIdsForTarget(target);
  if (!ids) {
    return false;
  }

  const payload = target.mediaType === 'movie'
    ? { movies: [{ ids }] }
    : { shows: [{ ids }] };
  return traktPost(inWatchlist ? '/sync/watchlist' : '/sync/watchlist/remove', accessToken, payload);
}

async function traktSetRating(accessToken: string, target: ProviderMutationTarget, rating: number | null): Promise<boolean> {
  const ids = traktIdsForTarget(target);
  if (!ids) {
    return false;
  }

  const item: Record<string, unknown> = { ids };
  if (rating !== null) {
    item.rating = rating;
  }
  const payload = target.mediaType === 'movie'
    ? { movies: [item] }
    : { shows: [item] };
  return traktPost(rating === null ? '/sync/ratings/remove' : '/sync/ratings', accessToken, payload);
}

async function simklAddToList(accessToken: string, target: ProviderMutationTarget, status: string): Promise<boolean> {
  if (!target.imdbId) {
    return false;
  }
  const payload = {
    [simklTypeKey(target.mediaType)]: [{ to: status, ids: { imdb: target.imdbId } }],
  };
  return simklPost('/sync/add-to-list', accessToken, payload);
}

async function simklRemoveFromList(accessToken: string, target: ProviderMutationTarget): Promise<boolean> {
  if (!target.imdbId) {
    return false;
  }
  const payload = {
    [simklTypeKey(target.mediaType)]: [{ ids: { imdb: target.imdbId } }],
  };
  return simklPost('/sync/remove-from-list', accessToken, payload);
}

async function simklAddRating(accessToken: string, target: ProviderMutationTarget, rating: number): Promise<boolean> {
  if (!target.imdbId) {
    return false;
  }
  const payload = {
    [simklTypeKey(target.mediaType)]: [{ ids: { imdb: target.imdbId }, rating }],
  };
  return simklPost('/sync/ratings', accessToken, payload);
}

function traktHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'trakt-api-key': env.traktImportClientId,
    'trakt-api-version': '2',
    'User-Agent': 'CrispyServer/1.0',
    Authorization: `Bearer ${accessToken}`,
  };
}

function simklHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'simkl-api-key': env.simklImportClientId,
  };
}

function traktIdsForTarget(target: ProviderMutationTarget): Record<string, unknown> | null {
  const ids: Record<string, unknown> = {};
  if (target.imdbId) {
    ids.imdb = target.imdbId;
  }
  if (target.tmdbId) {
    ids.tmdb = target.tmdbId;
  }
  return Object.keys(ids).length ? ids : null;
}

function simklTypeKey(mediaType: 'movie' | 'show'): 'movies' | 'shows' {
  return mediaType === 'movie' ? 'movies' : 'shows';
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

function mapTraktPlaybackItems(items: Array<Record<string, unknown>>, folderId: string): MappedProviderItem[] {
  return items.flatMap<MappedProviderItem>((item) => {
    const type = asString(item.type)?.toLowerCase();
    if (type === 'movie') {
      const movie = asRecord(item.movie);
      const ids = asRecord(movie?.ids);
      const resolveInput = buildResolveInputFromIds(ids, 'movie');
      const contentId = normalizedProviderContentId(ids);
      if (!movie || !contentId || !resolveInput) {
        return [];
      }

      return [{
        provider: 'trakt',
        folderId,
        contentId,
        contentType: 'movie',
        title: asString(movie.title) ?? contentId,
        posterUrl: traktPosterUrl(asRecord(movie.images)),
        backdropUrl: traktBackdropUrl(asRecord(movie.images)),
        seasonNumber: null,
        episodeNumber: null,
        addedAt: asIsoString(item.paused_at) ?? new Date().toISOString(),
        media: null,
        resolveInput,
      }];
    }

    if (type === 'episode') {
      const show = asRecord(item.show);
      const episode = asRecord(item.episode);
      const ids = asRecord(show?.ids);
      const seasonNumber = asPositiveInt(episode?.season);
      const episodeNumber = asPositiveInt(episode?.number);
      const contentId = normalizedProviderContentId(ids);
      const resolveInput = buildResolveInputFromIds(ids, 'episode', seasonNumber, episodeNumber);
      if (!show || !contentId || !seasonNumber || !episodeNumber || !resolveInput) {
        return [];
      }

      return [{
        provider: 'trakt',
        folderId,
        contentId,
        contentType: 'show',
        title: asString(show.title) ?? contentId,
        posterUrl: traktPosterUrl(asRecord(show.images)),
        backdropUrl: traktBackdropUrl(asRecord(show.images)),
        seasonNumber,
        episodeNumber,
        addedAt: asIsoString(item.paused_at) ?? new Date().toISOString(),
        media: null,
        resolveInput,
      }];
    }

    return [];
  });
}

function mapTraktWatchedItems(
  items: Array<Record<string, unknown>>,
  type: 'movie' | 'show',
  folderId: string,
): MappedProviderItem[] {
  return items.flatMap<MappedProviderItem>((item) => {
    const node = asRecord(type === 'movie' ? item.movie : item.show);
    const ids = asRecord(node?.ids);
    const contentId = normalizedProviderContentId(ids);
    const resolveInput = buildResolveInputFromIds(ids, type);
    if (!node || !contentId || !resolveInput) {
      return [];
    }

    return [{
      provider: 'trakt',
      folderId,
      contentId,
      contentType: type,
      title: asString(node.title) ?? contentId,
      posterUrl: traktPosterUrl(asRecord(node.images)),
      backdropUrl: traktBackdropUrl(asRecord(node.images)),
      seasonNumber: null,
      episodeNumber: null,
      addedAt: asIsoString(item.last_watched_at) ?? new Date().toISOString(),
      media: null,
      resolveInput,
    }];
  });
}

function mapTraktListItems(
  items: Array<Record<string, unknown>>,
  type: 'movie' | 'show',
  folderId: string,
  timestampField: 'listed_at' | 'rated_at' | 'collected_at',
): MappedProviderItem[] {
  return items.flatMap<MappedProviderItem>((item) => {
    const node = asRecord(type === 'movie' ? item.movie : item.show);
    const ids = asRecord(node?.ids);
    const contentId = normalizedProviderContentId(ids);
    const resolveInput = buildResolveInputFromIds(ids, type);
    if (!node || !contentId || !resolveInput) {
      return [];
    }

    return [{
      provider: 'trakt',
      folderId,
      contentId,
      contentType: type,
      title: asString(node.title) ?? contentId,
      posterUrl: traktPosterUrl(asRecord(node.images)),
      backdropUrl: traktBackdropUrl(asRecord(node.images)),
      seasonNumber: null,
      episodeNumber: null,
      addedAt: asIsoString(item[timestampField]) ?? new Date().toISOString(),
      media: null,
      resolveInput,
    }];
  });
}

function mapSimklPlaybackItems(
  items: Array<Record<string, unknown>>,
  contentType: 'movie' | 'show',
  folderId: string,
): MappedProviderItem[] {
  return items.flatMap<MappedProviderItem>((item) => {
    const content = asRecord(item.movie) ?? asRecord(item.show) ?? item;
    const ids = asRecord(content.ids);
    const contentId = normalizedProviderContentId(ids);
    const episode = asRecord(item.episode);
    const seasonNumber = asPositiveInt(episode?.season) ?? asPositiveInt(episode?.tvdb_season);
    const episodeNumber = asPositiveInt(episode?.episode) ?? asPositiveInt(episode?.number) ?? asPositiveInt(episode?.tvdb_number);
    const resolveInput = contentType === 'movie'
      ? buildResolveInputFromIds(ids, 'movie')
      : buildResolveInputFromIds(ids, 'episode', seasonNumber, episodeNumber);
    if (!content || !contentId || !resolveInput) {
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
      seasonNumber: seasonNumber ?? null,
      episodeNumber: episodeNumber ?? null,
      addedAt: asIsoString(item.paused_at) ?? new Date().toISOString(),
      media: null,
      resolveInput,
    }];
  });
}

function mapSimklAllItems(
  items: Array<Record<string, unknown>>,
  contentType: 'movie' | 'show',
  folderId: string,
): MappedProviderItem[] {
  return items.flatMap<MappedProviderItem>((wrapper) => {
    const content = asRecord(wrapper.movie) ?? asRecord(wrapper.show) ?? asRecord(wrapper.anime) ?? wrapper;
    const ids = asRecord(content.ids) ?? asRecord(wrapper.ids);
    const contentId = normalizedProviderContentId(ids);
    const resolveInput = buildResolveInputFromIds(ids, contentType);
    if (!content || !contentId || !resolveInput) {
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
      resolveInput,
    }];
  });
}

function mapSimklRatingsItems(items: Array<Record<string, unknown>>): MappedProviderItem[] {
  return items.flatMap<MappedProviderItem>((wrapper) => {
    const content = asRecord(wrapper.movie) ?? asRecord(wrapper.show) ?? asRecord(wrapper.anime) ?? wrapper;
    const ids = asRecord(content.ids) ?? asRecord(wrapper.ids);
    const contentId = normalizedProviderContentId(ids);
    const mediaType: 'movie' | 'show' = wrapper.movie ? 'movie' : 'show';
    const resolveInput = buildResolveInputFromIds(ids, mediaType);
    if (!content || !contentId || !resolveInput) {
      return [];
    }

    return [{
      provider: 'simkl',
      folderId: 'ratings',
      contentId,
      contentType: mediaType,
      title: asString(content.title) ?? contentId,
      posterUrl: asString(content.poster),
      backdropUrl: asString(content.fanart),
      seasonNumber: null,
      episodeNumber: null,
      addedAt: asIsoString(wrapper.rated_at) ?? asIsoString(wrapper.user_rated_at) ?? new Date().toISOString(),
      media: null,
      resolveInput,
    }];
  });
}

function buildResolveInputFromIds(
  ids: Record<string, unknown> | null,
  mediaType: 'movie' | 'show' | 'episode',
  seasonNumber?: number | null,
  episodeNumber?: number | null,
): ResolveInput | null {
  if (!ids) {
    return null;
  }

  const imdbId = normalizeImdbId(asString(ids.imdb));
  const tmdbId = asPositiveInt(ids.tmdb);
  const tvdbId = asPositiveInt(ids.tvdb);
  if (!imdbId && !tmdbId && !tvdbId) {
    return null;
  }
  if (mediaType === 'episode' && (!seasonNumber || !episodeNumber)) {
    return null;
  }

  return {
    tmdbId,
    imdbId,
    tvdbId,
    mediaType,
    seasonNumber: seasonNumber ?? null,
    episodeNumber: episodeNumber ?? null,
  };
}

function resolveCacheKey(input: ResolveInput): string {
  return JSON.stringify({
    id: input.id ?? null,
    tmdbId: input.tmdbId ?? null,
    imdbId: input.imdbId ?? null,
    tvdbId: input.tvdbId ?? null,
    mediaType: input.mediaType ?? null,
    seasonNumber: input.seasonNumber ?? null,
    episodeNumber: input.episodeNumber ?? null,
  });
}

function parseResolveCacheKey(key: string): ResolveInput {
  return JSON.parse(key) as ResolveInput;
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

function buildWatchlistStatusMessage(inWatchlist: boolean, results: ProviderMutationResultView[]): string {
  const successCount = results.filter((result) => result.status === 'success').length;
  if (successCount > 0) {
    return inWatchlist ? 'Saved to watchlist.' : 'Removed from watchlist.';
  }
  return firstMutationMessage(results) ?? (inWatchlist ? 'Unable to save to watchlist.' : 'Unable to remove from watchlist.');
}

function buildRatingStatusMessage(rating: number | null, results: ProviderMutationResultView[]): string {
  const successCount = results.filter((result) => result.status === 'success').length;
  if (successCount > 0) {
    return rating === null ? 'Removed rating.' : `Rated ${rating}/10.`;
  }
  return firstMutationMessage(results) ?? (rating === null ? 'Unable to remove rating.' : 'Unable to set rating.');
}

function firstMutationMessage(results: ProviderMutationResultView[]): string | null {
  for (const result of results) {
    if (result.message) {
      return result.message;
    }
  }
  return null;
}

function normalizeImdbId(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('tt')) {
    return normalized;
  }
  return /^\d+$/.test(normalized) ? `tt${normalized}` : null;
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
