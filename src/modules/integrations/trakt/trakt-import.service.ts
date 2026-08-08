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
  normalizeTraktPlayback,
  normalizeTraktRatings,
  normalizeTraktWatchedMovies,
  normalizeTraktWatchedShows,
  normalizeTraktWatchlist,
  type ResolveIdentityFn,
  type ShowProgress,
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

  private async findNextAvailableEpisode(
    client: DbClient,
    showTmdbId: number,
    highestSeason: number,
    highestEpisode: number,
  ): Promise<{ season: number; episode: number } | null> {
    const title = await this.tmdbCache.getTitle(client, 'tv', showTmdbId);
    if (!title) return null;

    let targetSeason = highestSeason;
    let targetEpisode = highestEpisode + 1;

    const season = await this.tmdbCache.getSeason(client, showTmdbId, targetSeason);
    if (season?.episodeCount && targetEpisode > season.episodeCount) {
      targetSeason += 1;
      targetEpisode = 1;
      if (title.numberOfSeasons && targetSeason > title.numberOfSeasons) {
        return null;
      }
    }

    const episode = await this.tmdbCache.getEpisode(client, showTmdbId, targetSeason, targetEpisode);
    if (!episode) {
      const freshSeason = await this.tmdbCache.ensureSeasonCached(client, showTmdbId, targetSeason).catch(() => null);
      if (!freshSeason) return null;
      if (freshSeason.episodeCount && targetEpisode > freshSeason.episodeCount) {
        return null;
      }
    }

    return { season: targetSeason, episode: targetEpisode };
  }

  private async deriveContinueWatching(
    showProgress: Map<string, ShowProgress>,
    collector: ImportAccumulator,
  ): Promise<void> {
    await withDbClient(async (client) => {
      const now = new Date().toISOString();
      for (const { resolvedShow, highestSeason, highestEpisode, episodeCount } of showProgress.values()) {
        if (episodeCount < 2) continue;
        if (!resolvedShow.tmdbId) continue;

        const next = await this.findNextAvailableEpisode(client, resolvedShow.tmdbId, highestSeason, highestEpisode);
        if (!next) continue;

        const identity = buildImportedEpisodeIdentity(resolvedShow, next.season, next.episode);
        collector.importedEvents.push(buildImportedEpisodeEvent({
          eventType: 'playback_progress_snapshot',
          identity,
          resolvedShow,
          occurredAt: now,
          progressBps: 0,
          payload: { provider: 'trakt', source: 'continue_watching_derived' },
        }));
        collector.mediaKeysToRefresh.add(resolvedShow.identity.mediaKey);
      }
    });
  }

  async fetchAndNormalizeImport(
    job: ProviderImportJobRecord,
    credentialsJson: Record<string, unknown>,
  ): Promise<ProviderReplaceImportPayload> {
    void job;
    const accessToken = requireConnectedAccessToken(credentialsJson);

    const [watchedMovies, watchedShows, watchlistMovies, watchlistShows, ratingMovies, ratingShows, playback] = await Promise.all([
      this.traktClient.getArrayPaginated('/sync/watched/movies', accessToken),
      this.traktClient.getArrayPaginated('/sync/watched/shows', accessToken, { extended: 'progress' }),
      this.traktClient.getArrayPaginated('/sync/watchlist/movies', accessToken),
      this.traktClient.getArrayPaginated('/sync/watchlist/shows', accessToken),
      this.traktClient.getArrayPaginated('/sync/ratings/movies', accessToken),
      this.traktClient.getArrayPaginated('/sync/ratings/shows', accessToken),
      this.traktClient.getArrayPaginated('/sync/playback', accessToken),
    ]);

    const collector = createImportAccumulator();
    const resolveIdentityCache = new Map<string, ResolvedImportIdentity | null>();
    const resolveIdentity: ResolveIdentityFn = (params) => this.traktResolver.resolve(resolveIdentityCache, params);
    const showProgress = new Map<string, ShowProgress>();

    await normalizeTraktWatchedMovies(watchedMovies, resolveIdentity, collector);
    await normalizeTraktWatchedShows(watchedShows, resolveIdentity, collector, showProgress);
    await normalizeTraktWatchlist([...watchlistMovies, ...watchlistShows], resolveIdentity, collector);
    await normalizeTraktRatings([...ratingMovies, ...ratingShows], resolveIdentity, collector);
    await normalizeTraktPlayback(playback, resolveIdentity, collector);
    await this.deriveContinueWatching(showProgress, collector);

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
