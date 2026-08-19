import { TmdbExternalIdResolverService } from '../../metadata/providers/tmdb-external-id-resolver.service.js';
import { TmdbCacheService } from '../../metadata/providers/tmdb-cache.service.js';
import { MetadataCardService } from '../../metadata/metadata-card.service.js';
import type { DbClient } from '../../../lib/db.js';
import { withDbClient } from '../../../lib/db.js';
import type { ProviderImportProvider } from '../provider-import.types.js';
import type {
  ProviderImportModule,
  ProviderProfileResult,
  ProviderReplaceImportPayload,
  ProviderTokenExchangeResult,
  ResolvedImportIdentity,
  RuntimeLookup,
} from '../provider-import.internals.js';
import {
  createImportAccumulator,
  type ImportAccumulator,
  type ImportIdentityLookup,
} from '../provider-import.internals.js';
import { requireConnectedAccessToken } from '../provider-import.utils.js';
import { TraktImportClient } from './trakt-import.client.js';
import { TraktImportIdentityResolver } from './trakt-import.resolver.js';
import {
  buildImportedEpisodeEvent,
  buildImportedEpisodeIdentity,
  normalizeTraktHistoryMovies,
  normalizeTraktHistoryShows,
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
  private readonly tmdbCache: TmdbCacheService;

  constructor(deps: TraktImportServiceDeps = {}) {
    this.traktClient = deps.client ?? new TraktImportClient();
    this.tmdbCache = deps.tmdbCacheService ?? new TmdbCacheService();
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

  /**
   * Resolves a content item's runtime (minutes) from the local catalog so the
   * ingestor can turn a provider's `progress%` into an absolute resume position.
   * Mirrors Jellyfin, where the client reports a position and the item supplies
   * its `RunTimeTicks`. Episodes fall back to the show's average episode runtime.
   */
  private buildRuntimeLookup(client: DbClient): RuntimeLookup {
    return async (params) => {
      if (params.mediaType === 'movie' && params.tmdbId) {
        const result = await client.query(
          `SELECT runtime FROM public.tmdb_titles WHERE media_type = 'movie' AND tmdb_id = $1 LIMIT 1`,
          [params.tmdbId],
        );
        const runtime = result.rows[0]?.runtime;
        return typeof runtime === 'number' && runtime > 0 ? runtime : null;
      }
      if (params.mediaType === 'episode' && params.showTmdbId && params.seasonNumber && params.episodeNumber) {
        const episodeResult = await client.query(
          `SELECT runtime FROM public.tmdb_tv_episodes WHERE show_tmdb_id = $1 AND season_number = $2 AND episode_number = $3 LIMIT 1`,
          [params.showTmdbId, params.seasonNumber, params.episodeNumber],
        );
        const episodeRuntime = episodeResult.rows[0]?.runtime;
        if (typeof episodeRuntime === 'number' && episodeRuntime > 0) {
          return episodeRuntime;
        }
        const showResult = await client.query(
          `SELECT episode_run_time FROM public.tmdb_titles WHERE media_type = 'tv' AND tmdb_id = $1 LIMIT 1`,
          [params.showTmdbId],
        );
        const runTimes = showResult.rows[0]?.episode_run_time;
        if (Array.isArray(runTimes) && typeof runTimes[0] === 'number' && runTimes[0] > 0) {
          return runTimes[0];
        }
      }
      return null;
    };
  }

  async fetchAndNormalizeImport(
    job: ProviderImportJobRecord,
    credentialsJson: Record<string, unknown>,
  ): Promise<ProviderReplaceImportPayload> {
    void job;
    const accessToken = requireConnectedAccessToken(credentialsJson);

    const [watchedMovies, watchedShows, historyMovies, historyShows, watchlistMovies, watchlistShows, ratingMovies, ratingShows, playback] = await Promise.all([
      this.traktClient.getArrayPaginated('/sync/watched/movies', accessToken),
      this.traktClient.getArrayPaginated('/sync/watched/shows', accessToken, { extended: 'progress' }),
      this.traktClient.getArrayPaginated('/sync/history/movies', accessToken),
      this.traktClient.getArrayPaginated('/sync/history/shows', accessToken),
      this.traktClient.getArrayPaginated('/sync/watchlist/movies', accessToken),
      this.traktClient.getArrayPaginated('/sync/watchlist/shows', accessToken),
      this.traktClient.getArrayPaginated('/sync/ratings/movies', accessToken),
      this.traktClient.getArrayPaginated('/sync/ratings/shows', accessToken),
      this.traktClient.getArrayPaginated('/sync/playback', accessToken),
    ]);

    const collector = createImportAccumulator();
    const resolveIdentityCache = new Map<string, ResolvedImportIdentity | null>();
    const resolveIdentity: ResolveIdentityFn = (params) => this.traktResolver.resolve(resolveIdentityCache, params);

    await normalizeTraktWatchedMovies(watchedMovies, resolveIdentity, collector);
    await normalizeTraktWatchedShows(watchedShows, resolveIdentity, collector);
    await normalizeTraktHistoryMovies(historyMovies, resolveIdentity, collector);
    await normalizeTraktHistoryShows(historyShows, resolveIdentity, collector);
    await normalizeTraktWatchlist([...watchlistMovies, ...watchlistShows], resolveIdentity, collector);
    await normalizeTraktRatings([...ratingMovies, ...ratingShows], resolveIdentity, collector);
    await withDbClient(async (client) => {
      const runtimeLookup = this.buildRuntimeLookup(client);
      await normalizeTraktPlayback(playback, resolveIdentity, collector, runtimeLookup);
    });

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
