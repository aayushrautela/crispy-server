import { TmdbExternalIdResolverService } from '../../metadata/providers/tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from '../../metadata/providers/tmdb-cache.service.js';
import { MetadataCardService } from '../../metadata/metadata-card.service.js';
import type { ProviderImportProvider } from '../provider-import.types.js';
import type {
  ProviderImportModule,
  ProviderProfileResult,
  ProviderReplaceImportPayload,
  ProviderTokenExchangeResult,
  ResolvedImportIdentity,
} from '../provider-import.internals.js';
import type { ImportIdentityLookup } from '../provider-import.internals.js';
import {
  createImportAccumulator,
} from '../provider-import.internals.js';
import { requireConnectedAccessToken } from '../provider-import.utils.js';
import { TraktImportIdentityResolver } from '../trakt/trakt-import.resolver.js';
import { SimklImportClient } from './simkl-import.client.js';
import {
  normalizeSimklMovies,
  normalizeSimklPlayback,
  normalizeSimklRatings,
  normalizeSimklShowsAndAnime,
  type SimklResolveFn,
} from './simkl-import.normalizer.js';
import type { ProviderImportJobRecord } from '../provider-import-jobs.repo.js';

type SimklImportServiceDeps = {
  externalIdResolver?: TmdbExternalIdResolverService;
  tmdbCacheService?: TmdbCacheService;
  metadataCardService?: MetadataCardService;
  client?: SimklImportClient;
  resolver?: TraktImportIdentityResolver;
};

const SIMKL_STATUSES = ['watching', 'plantowatch', 'hold', 'completed', 'dropped'] as const;
type SimklStatus = (typeof SIMKL_STATUSES)[number];

export class SimklImportService implements ProviderImportModule {
  readonly provider: ProviderImportProvider = 'simkl';
  private readonly simklClient: SimklImportClient;
  private readonly identityResolver: TraktImportIdentityResolver;

  constructor(deps: SimklImportServiceDeps = {}) {
    this.simklClient = deps.client ?? new SimklImportClient();
    this.identityResolver = deps.resolver ?? new TraktImportIdentityResolver({
      externalIdResolver: deps.externalIdResolver ?? new TmdbExternalIdResolverService(),
      tmdbCacheService: deps.tmdbCacheService ?? new TmdbCacheService(),
      metadataCardService: deps.metadataCardService ?? new MetadataCardService(),
    });
  }

  isConfigured(): boolean {
    return this.simklClient.isConfigured();
  }

  buildAuthUrl(stateToken: string, codeChallenge: string): string | null {
    return this.simklClient.buildAuthUrl(stateToken, codeChallenge);
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<ProviderTokenExchangeResult> {
    return this.simklClient.exchangeAuthorizationCode(code, codeVerifier);
  }

  async fetchProfile(accessToken: string): Promise<ProviderProfileResult> {
    return this.simklClient.fetchProfile(accessToken);
  }

  async revokeAuthorization(credentialsJson: Record<string, unknown>): Promise<void> {
    return this.simklClient.revokeAuthorization(credentialsJson);
  }

  resolveImportIdentity(
    cache: Map<string, ResolvedImportIdentity | null>,
    params: ImportIdentityLookup,
  ): Promise<ResolvedImportIdentity | null> {
    return this.identityResolver.resolve(cache, params);
  }

  async fetchAndNormalizeImport(
    job: ProviderImportJobRecord,
    credentialsJson: Record<string, unknown>,
  ): Promise<ProviderReplaceImportPayload> {
    void job;
    const accessToken = requireConnectedAccessToken(credentialsJson);

    const [movieLists, showLists, animeLists, ratingMovies, ratingShows, ratingAnime, moviePlayback, episodePlayback] = await Promise.all([
      Promise.all(SIMKL_STATUSES.map(async (status) => ({
        status,
        mediaFamily: 'movie' as const,
        items: await this.simklClient.getArray(`/sync/all-items/movies/${status}`, accessToken, { extended: 'full' }, 'movies'),
      }))),
      Promise.all(SIMKL_STATUSES.map(async (status) => ({
        status,
        mediaFamily: 'show' as const,
        items: await this.simklClient.getArray(
          `/sync/all-items/shows/${status}`,
          accessToken,
          { extended: 'full', episode_watched_at: 'yes' },
          'shows',
        ),
      }))),
      Promise.all(SIMKL_STATUSES.map(async (status) => ({
        status,
        mediaFamily: 'anime' as const,
        items: await this.simklClient.getArray(
          `/sync/all-items/anime/${status}`,
          accessToken,
          { extended: 'full_anime_seasons', episode_watched_at: 'yes' },
          'anime',
        ),
      }))),
      this.simklClient.getArray('/sync/ratings/movies', accessToken, undefined, 'movies'),
      this.simklClient.getArray('/sync/ratings/shows', accessToken, undefined, 'shows'),
      this.simklClient.getArray('/sync/ratings/anime', accessToken, undefined, 'anime'),
      this.simklClient.getArray('/sync/playback/movies', accessToken),
      this.simklClient.getArray('/sync/playback/episodes', accessToken),
    ]);

    const collector = createImportAccumulator();
    const resolvedCache = new Map<string, ResolvedImportIdentity | null>();
    const resolveIdentity: SimklResolveFn = (params) => this.identityResolver.resolve(resolvedCache, params);

    await normalizeSimklMovies(movieLists, resolveIdentity, collector);
    await normalizeSimklShowsAndAnime([...showLists, ...animeLists], resolveIdentity, collector);
    await normalizeSimklRatings(ratingMovies, ratingShows, ratingAnime, resolveIdentity, collector);
    await normalizeSimklPlayback(moviePlayback, episodePlayback, resolveIdentity, collector);

    const importedAt = new Date().toISOString();
    const watchlistCount = movieLists.reduce((count, group) => count + (group.status === 'completed' ? 0 : group.items.length), 0)
      + showLists.reduce((count, group) => count + (group.status === 'completed' ? 0 : group.items.length), 0)
      + animeLists.reduce((count, group) => count + (group.status === 'completed' ? 0 : group.items.length), 0);
    const watchedShowCount = showLists.reduce((count, group) => count + group.items.length, 0)
      + animeLists.reduce((count, group) => count + group.items.length, 0);

    return {
      importedEvents: collector.importedEvents,
      importedHistoryEntries: collector.importedHistoryEntries,
      importedAt,
      mediaKeysToRefresh: Array.from(collector.mediaKeysToRefresh),
      importSummary: {
        provider: 'simkl',
        watchedMovieCount: movieLists.find((group) => group.status === 'completed')?.items.length ?? 0,
        watchedShowCount,
        watchlistCount,
        ratingCount: ratingMovies.length + ratingShows.length + ratingAnime.length,
        playbackCount: moviePlayback.length + episodePlayback.length,
      },
    };
  }
}

export type { SimklStatus };
