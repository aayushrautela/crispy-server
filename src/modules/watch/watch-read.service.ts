import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { MetadataViewService } from '../metadata/metadata-view.service.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { inferMediaIdentity } from './media-key.js';
import { ContinueWatchingRepository } from './continue-watching.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';
import type { HydratedWatchItem } from './watch-read.types.js';

export class WatchReadService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly metadataViewService = new MetadataViewService(),
    private readonly continueWatchingRepository = new ContinueWatchingRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
  ) {}

  async listContinueWatching(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const rows = await this.continueWatchingRepository.list(client, profileId, limit);
      return Promise.all(
        rows.map(async (row) => {
          const identity = inferMediaIdentity({
            mediaKey: String(row.media_key),
            mediaType: String(row.media_type),
            tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
            showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
            seasonNumber: row.season_number === null ? null : Number(row.season_number),
            episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
          });
          const media = await this.metadataViewService.buildMetadataView(client, identity);
          return {
            media,
            progress: {
              positionSeconds: row.position_seconds === null ? null : Number(row.position_seconds),
              durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
              progressPercent: Number(row.progress_percent ?? 0),
              lastPlayedAt: String(row.last_activity_at),
            },
            lastActivityAt: String(row.last_activity_at),
            payload: (row.payload as Record<string, unknown> | undefined) ?? {},
          } satisfies HydratedWatchItem;
        }),
      );
    });
  }

  async listHistory(userId: string, profileId: string, limit: number): Promise<HydratedWatchItem[]> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }

      const rows = await this.watchHistoryRepository.list(client, profileId, limit);
      return Promise.all(
        rows.map(async (row) => {
          const identity = inferMediaIdentity({
            mediaKey: String(row.media_key),
            mediaType: String(row.media_type),
            tmdbId: row.tmdb_id === null ? null : Number(row.tmdb_id),
            showTmdbId: row.show_tmdb_id === null ? null : Number(row.show_tmdb_id),
            seasonNumber: row.season_number === null ? null : Number(row.season_number),
            episodeNumber: row.episode_number === null ? null : Number(row.episode_number),
          });
          const media = await this.metadataViewService.buildMetadataView(client, identity);
          return {
            media,
            watchedAt: String(row.watched_at),
            payload: (row.payload as Record<string, unknown> | undefined) ?? {},
          } satisfies HydratedWatchItem;
        }),
      );
    });
  }
}
