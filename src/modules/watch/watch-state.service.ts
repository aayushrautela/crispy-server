import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { inferMediaIdentity, type MediaIdentity, parseMediaKey, showTmdbIdForIdentity } from './media-key.js';
import { MediaProgressRepository } from './media-progress.repo.js';
import { RatingsRepository } from './ratings.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';
import type { WatchStateLookupInput, WatchStateResponse } from './watch-read.types.js';

export class WatchStateService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly metadataViewService = new MetadataViewService(),
    private readonly mediaProgressRepository = new MediaProgressRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
  ) {}

  async getState(userId: string, profileId: string, input: WatchStateLookupInput): Promise<WatchStateResponse> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const identity = resolveIdentity(input);
      const [metadata, progress, watched, continueWatching, watchlist, rating] = await Promise.all([
        this.metadataViewService.buildMetadataView(client, identity),
        this.mediaProgressRepository.getByMediaKey(client, profileId, identity.mediaKey),
        this.watchHistoryRepository.getByMediaKey(client, profileId, identity.mediaKey),
        this.continueWatchingRepository.getByMediaKey(client, profileId, identity.mediaKey),
        this.watchlistRepository.getByMediaKey(client, profileId, identity.mediaKey),
        this.ratingsRepository.getByMediaKey(client, profileId, identity.mediaKey),
      ]);

      const trackedShowTmdbId = showTmdbIdForIdentity(identity);
      const watchedEpisodeKeys = trackedShowTmdbId
        ? Array.from(await this.watchHistoryRepository.listWatchedEpisodeKeys(client, profileId, trackedShowTmdbId))
        : [];

      return {
        media: metadata,
        progress: progress
          ? {
              positionSeconds: progress.positionSeconds,
              durationSeconds: progress.durationSeconds,
              progressPercent: progress.progressPercent,
              status: progress.status,
              lastPlayedAt: progress.lastPlayedAt,
            }
          : null,
        continueWatching: continueWatching
          ? {
              id: String(continueWatching.id),
              positionSeconds: continueWatching.position_seconds === null ? null : Number(continueWatching.position_seconds),
              durationSeconds: continueWatching.duration_seconds === null ? null : Number(continueWatching.duration_seconds),
              progressPercent: Number(continueWatching.progress_percent ?? 0),
              lastActivityAt: String(continueWatching.last_activity_at),
            }
          : null,
        watched: watched
          ? {
              watchedAt: String(watched.watched_at),
            }
          : null,
        watchlist: watchlist
          ? {
              addedAt: String(watchlist.added_at),
            }
          : null,
        rating: rating
          ? {
              value: Number(rating.rating),
              ratedAt: String(rating.rated_at),
            }
          : null,
        watchedEpisodeKeys,
      };
    });
  }

  async getStates(userId: string, profileId: string, inputs: WatchStateLookupInput[]): Promise<WatchStateResponse[]> {
    if (inputs.length === 0) {
      return [];
    }

    return Promise.all(inputs.map((input) => this.getState(userId, profileId, input)));
  }
}

function resolveIdentity(input: WatchStateLookupInput): MediaIdentity {
  if (input.mediaKey?.trim()) {
    return parseMediaKey(input.mediaKey.trim());
  }

  if (!input.mediaType) {
    throw new HttpError(400, 'mediaKey or mediaType is required.');
  }

  return inferMediaIdentity({
    mediaKey: input.mediaKey,
    mediaType: input.mediaType,
    tmdbId: input.tmdbId,
    showTmdbId: input.showTmdbId,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber,
  });
}
