import { withDbClient } from '../../lib/db.js';
import { nowIso } from '../../lib/time.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchedQueryService } from '../watch/watched.service.js';
import { WatchCollectionService } from '../watch/watch-collection.service.js';
import type { ProfileLibraryView } from './library.types.js';

export class LibraryService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly continueWatchingService = new ContinueWatchingService(),
    private readonly watchedService = new WatchedQueryService(),
    private readonly watchCollectionService = new WatchCollectionService(),
  ) {}

  async getProfileLibrary(userId: string, profileId: string): Promise<ProfileLibraryView> {
    await withDbClient((client) => this.profileAccessService.assertOwnedProfile(client, profileId, userId));

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
}
