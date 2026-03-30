import { redis } from '../../lib/redis.js';
import { appConfig } from '../../config/app-config.js';
import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { calendarCacheKey } from '../cache/cache-keys.js';
import type { CalendarResponse } from '../watch/watch-read.types.js';
import { CalendarBuilderService } from './calendar-builder.service.js';

export class CalendarService {
  constructor(
    private readonly profileRepository = new ProfileRepository(),
    private readonly calendarBuilderService = new CalendarBuilderService(),
  ) {}

  async getCalendar(userId: string, profileId: string): Promise<CalendarResponse> {
    const cacheKey = calendarCacheKey(profileId);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as CalendarResponse;
    }

    const items = await withDbClient(async (client) => {
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, userId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found.');
      }
      return this.calendarBuilderService.build(client, profileId, 25);
    });

    const response = {
      profileId,
      source: 'canonical_calendar' as const,
      generatedAt: nowIso(),
      items,
    };

    await redis.set(cacheKey, JSON.stringify(response), 'EX', appConfig.cache.calendarTtlSeconds);
    return response;
  }
}
