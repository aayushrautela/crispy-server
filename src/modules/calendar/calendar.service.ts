import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import type { CalendarResponse } from '../watch/watch-read.types.js';
import { CalendarBuilderService } from './calendar-builder.service.js';

export class CalendarService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly calendarBuilderService = new CalendarBuilderService(),
  ) {}

  async getCalendar(userId: string, profileId: string): Promise<CalendarResponse> {
    const cacheKey = `calendar:${profileId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as CalendarResponse;
    }

    const items = await withTransaction(async (client) => {
      const profile = await this.profileRepository.findByIdForUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      return this.calendarBuilderService.build(client, profileId, 25);
    });

    const response = {
      generatedAt: new Date().toISOString(),
      items,
    };

    await redis.set(cacheKey, JSON.stringify(response), 'EX', env.calendarCacheTtlSeconds);
    return response;
  }
}
