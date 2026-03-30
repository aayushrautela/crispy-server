import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchedQueryService } from '../watch/watched.service.js';
import { WatchCollectionService } from '../watch/watch-collection.service.js';
import type { ProfileLibraryView } from './library.types.js';

export class LibraryService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly continueWatchingService = new ContinueWatchingService(),
    private readonly watchedService = new WatchedQueryService(),
    private readonly watchCollectionService = new WatchCollectionService(),
  ) {}

  async getProfileLibrary(userId: string, profileId: string): Promise<ProfileLibraryView> {
    await this.requireOwnedProfile(userId, profileId);

    const [watched, watchlist] = await Promise.all([
      this.watchedService.list(userId, profileId, 100),
      this.watchCollectionService.listWatchlist(userId, profileId, 100),
    ]);

    return {
      profileId,
      generatedAt: nowIso(),
      watched,
      watchlist,
    };
  }

  async requireOwnedProfile(userId: string, profileId: string): Promise<void> {
    await withDbClient(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
    });
  }
}
