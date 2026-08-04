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
import {
  createImportAccumulator,
  type ImportIdentityLookup,
} from '../provider-import.internals.js';
import { requireConnectedAccessToken } from '../provider-import.utils.js';
import { TraktImportClient } from './trakt-import.client.js';
import { TraktImportIdentityResolver } from './trakt-import.resolver.js';
import {
  normalizeTraktPlayback,
  normalizeTraktRatings,
  normalizeTraktWatchedMovies,
  normalizeTraktWatchedShows,
  normalizeTraktWatchlist,
  type ResolveIdentityFn,
} from './trakt-import.normalizer.js';
import type { ProviderImportJobRecord } from '../provider-import-jobs.repo.js';

type TraktImportServiceDeps = {
  externalIdResolver?: TmdbExternalIdResolverService;
  tmdbCacheService?: TmdbCacheService;
  metadataCardService?: MetadataCardService;
  client?: TraktImportClient;
  resolver?: TraktImportIdentityResolver;
};

export class TraktImportService implements ProviderImportModule {
  readonly provider: ProviderImportProvider = 'trakt';
  private readonly traktClient: TraktImportClient;
  private readonly traktResolver: TraktImportIdentityResolver;

  constructor(deps: TraktImportServiceDeps = {}) {
    this.traktClient = deps.client ?? new TraktImportClient();
    this.traktResolver = deps.resolver ?? new TraktImportIdentityResolver({
      externalIdResolver: deps.externalIdResolver ?? new TmdbExternalIdResolverService(),
      tmdbCacheService: deps.tmdbCacheService ?? new TmdbCacheService(),
      metadataCardService: deps.metadataCardService ?? new MetadataCardService(),
    });
  }

  isConfigured(): boolean {
    return this.traktClient.isConfigured();
  }

  buildAuthUrl(stateToken: string, codeChallenge: string): string | null {
    return this.traktClient.buildAuthUrl(stateToken, codeChallenge);
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<ProviderTokenExchangeResult> {
    return this.traktClient.exchangeAuthorizationCode(code, codeVerifier);
  }

  async fetchProfile(accessToken: string): Promise<ProviderProfileResult> {
    return this.traktClient.fetchProfile(accessToken);
  }

  async revokeAuthorization(credentialsJson: Record<string, unknown>): Promise<void> {
    return this.traktClient.revokeAuthorization(credentialsJson);
  }

  resolveImportIdentity(
    cache: Map<string, ResolvedImportIdentity | null>,
    params: ImportIdentityLookup,
  ): Promise<ResolvedImportIdentity | null> {
    return this.traktResolver.resolve(cache, params);
  }

  async fetchAndNormalizeImport(
    job: ProviderImportJobRecord,
    credentialsJson: Record<string, unknown>,
  ): Promise<ProviderReplaceImportPayload> {
    void job;
    const accessToken = requireConnectedAccessToken(credentialsJson);

    const [watchedMovies, watchedShows, watchlistMovies, watchlistShows, ratingMovies, ratingShows, playback] = await Promise.all([
      this.traktClient.getArray('/sync/watched/movies', accessToken),
      this.traktClient.getArray('/sync/watched/shows', accessToken),
      this.traktClient.getArray('/sync/watchlist/movies', accessToken),
      this.traktClient.getArray('/sync/watchlist/shows', accessToken),
      this.traktClient.getArray('/sync/ratings/movies', accessToken),
      this.traktClient.getArray('/sync/ratings/shows', accessToken),
      this.traktClient.getArray('/sync/playback', accessToken),
    ]);

    const collector = createImportAccumulator();
    const resolveIdentityCache = new Map<string, ResolvedImportIdentity | null>();
    const resolveIdentity: ResolveIdentityFn = (params) => this.traktResolver.resolve(resolveIdentityCache, params);

    await normalizeTraktWatchedMovies(watchedMovies, resolveIdentity, collector);
    await normalizeTraktWatchedShows(watchedShows, resolveIdentity, collector);
    await normalizeTraktWatchlist([...watchlistMovies, ...watchlistShows], resolveIdentity, collector);
    await normalizeTraktRatings([...ratingMovies, ...ratingShows], resolveIdentity, collector);
    await normalizeTraktPlayback(playback, resolveIdentity, collector);

    return {
      importedEvents: collector.importedEvents,
      importedHistoryEntries: collector.importedHistoryEntries,
      importedAt: new Date().toISOString(),
      mediaKeysToRefresh: Array.from(collector.mediaKeysToRefresh),
      importSummary: {
        provider: 'trakt',
        watchedMovieCount: watchedMovies.length,
        watchedShowCount: watchedShows.length,
        watchlistCount: watchlistMovies.length + watchlistShows.length,
        ratingCount: ratingMovies.length + ratingShows.length,
        playbackCount: playback.length,
      },
    };
  }
}
