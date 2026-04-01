import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { requireDbIsoString } from '../../lib/time.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { parentMediaTypeForIdentity, type MediaIdentity, parseMediaKey } from '../identity/media-key.js';
import { MediaProgressRepository } from './media-progress.repo.js';
import { RatingsRepository } from './ratings.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import { WatchlistRepository } from './watchlist.repo.js';
import type { WatchStateLookupInput, WatchStateResponse } from './watch-read.types.js';

export class WatchStateService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly metadataViewService = new MetadataViewService(),
    private readonly mediaProgressRepository = new MediaProgressRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchlistRepository = new WatchlistRepository(),
    private readonly ratingsRepository = new RatingsRepository(),
  ) {}

  async getState(userId: string, profileId: string, input: WatchStateLookupInput): Promise<WatchStateResponse> {
    return withDbClient(async (client) => {
      await this.profileAccessService.assertOwnedProfile(client, profileId, userId);

      const identity = resolveIdentity(input);
      const [metadata, progress, watched, continueWatching, watchlist, rating] = await Promise.all([
        this.metadataViewService.buildMetadataView(client, identity),
        this.mediaProgressRepository.getByMediaKey(client, profileId, identity.mediaKey),
        this.watchHistoryRepository.getByMediaKey(client, profileId, identity.mediaKey),
        this.continueWatchingRepository.getByMediaKey(client, profileId, identity.mediaKey),
        this.watchlistRepository.getByMediaKey(client, profileId, identity.mediaKey),
        this.ratingsRepository.getByMediaKey(client, profileId, identity.mediaKey),
      ]);

      const trackedMediaKey = toTrackedMediaKey(identity);
      const watchedEpisodeKeys = trackedMediaKey
        ? Array.from(await this.watchHistoryRepository.listWatchedEpisodeKeysForTrackedMedia(client, profileId, trackedMediaKey))
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
              lastActivityAt: requireDbIsoString(continueWatching.last_activity_at as Date | string | null | undefined, 'continue_watching_projection.last_activity_at'),
            }
          : null,
        watched: watched
          ? {
              watchedAt: requireDbIsoString(watched.watched_at as Date | string | null | undefined, 'watch_history_latest.watched_at'),
            }
          : null,
        watchlist: watchlist
          ? {
              addedAt: requireDbIsoString(watchlist.added_at as Date | string | null | undefined, 'watchlist_items.added_at'),
            }
          : null,
        rating: rating
          ? {
              value: Number(rating.rating),
              ratedAt: requireDbIsoString(rating.rated_at as Date | string | null | undefined, 'ratings.rated_at'),
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

function toTrackedMediaKey(identity: MediaIdentity): string | null {
  if ((identity.mediaType === 'show' || identity.mediaType === 'anime') && identity.provider && identity.providerId) {
    return identity.mediaKey;
  }

  if ((identity.mediaType === 'season' || identity.mediaType === 'episode') && identity.parentProvider && identity.parentProviderId) {
    const parentMediaType = parentMediaTypeForIdentity(identity);
    if (parentMediaType === 'show' || parentMediaType === 'anime') {
      return `${parentMediaType}:${identity.parentProvider}:${identity.parentProviderId}`;
    }
  }

  return null;
}

function resolveIdentity(input: WatchStateLookupInput): MediaIdentity {
  if (input.mediaKey.trim()) {
    return parseMediaKey(input.mediaKey.trim());
  }

  throw new HttpError(400, 'mediaKey is required.');
}
