import { redis } from '../../lib/redis.js';
import { appConfig } from '../../config/app-config.js';
import { withDbClient } from '../../lib/db.js';
import { nowIso } from '../../lib/time.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { calendarCacheKey } from '../cache/cache-keys.js';
import type { CalendarResponse, ThisWeekResponse } from '../watch/watch-read.types.js';
import { CalendarBuilderService } from './calendar-builder.service.js';

export class CalendarService {
  constructor(
    private readonly profileAccessService = new ProfileAccessService(),
    private readonly calendarBuilderService = new CalendarBuilderService(),
  ) {}

  async getCalendar(userId: string, profileId: string): Promise<CalendarResponse> {
    const validatedProfileId = await withDbClient(async (client) => {
      const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, userId);
      return profile.id;
    });
    return this.getCalendarForValidatedProfile(validatedProfileId);
  }

  async getCalendarForAccountService(accountId: string, profileId: string): Promise<CalendarResponse> {
    const validatedProfileId = await withDbClient(async (client) => {
      const profile = await this.profileAccessService.assertOwnedProfile(client, profileId, accountId);
      return profile.id;
    });
    return this.getCalendarForValidatedProfile(validatedProfileId);
  }

  async getThisWeek(userId: string, profileId: string): Promise<ThisWeekResponse> {
    const calendar = await this.getCalendar(userId, profileId);
    return {
      profileId,
      source: 'canonical_calendar',
      kind: 'this-week',
      generatedAt: calendar.generatedAt,
      items: calendar.items.filter((item) => item.bucket === 'this_week').slice(0, 10),
    };
  }

  async getThisWeekForAccountService(accountId: string, profileId: string): Promise<ThisWeekResponse> {
    const calendar = await this.getCalendarForAccountService(accountId, profileId);
    return {
      profileId,
      source: 'canonical_calendar',
      kind: 'this-week',
      generatedAt: calendar.generatedAt,
      items: calendar.items.filter((item) => item.bucket === 'this_week').slice(0, 10),
    };
  }

  private async getCalendarForValidatedProfile(profileId: string): Promise<CalendarResponse> {
    const cacheKey = calendarCacheKey(profileId);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as CalendarResponse;
    }

    const items = await withDbClient(async (client) => {
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
