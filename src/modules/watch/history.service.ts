import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { WatchHistoryRepository } from './watch-history.repo.js';

export class WatchHistoryQueryService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly watchHistoryRepository = new WatchHistoryRepository(),
  ) {}

  async list(userId: string, profileId: string, limit: number): Promise<Record<string, unknown>[]> {
    return withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      return this.watchHistoryRepository.list(client, profileId, limit);
    });
  }
}
