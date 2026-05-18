import { redis } from '../../lib/redis.js';
import { appConfig } from '../../config/app-config.js';
import { withDbClient } from '../../lib/db.js';
import { nowIso } from '../../lib/time.js';
import { ProfileAccessService } from '../profiles/profile-access.service.js';
import { calendarCacheKey } from '../cache/cache-keys.js';
import type { CalendarResponse } from './calendar.types.js';
import { CalendarBuilderService } from './calendar-builder.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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

  async getThisWeek(userId: string, profileId: string): Promise<CalendarResponse> {
    const calendar = await this.getCalendar(userId, profileId);
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: calendar.generatedAt,
      items: calendar.items.filter((item) => isItemInThisWeek(item)).slice(0, 10),
    };
  }

  async getThisWeekForAccountService(accountId: string, profileId: string): Promise<CalendarResponse> {
    const calendar = await this.getCalendarForAccountService(accountId, profileId);
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: calendar.generatedAt,
      items: calendar.items.filter((item) => isItemInThisWeek(item)).slice(0, 10),
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

    const response: CalendarResponse = {
      profileId,
      source: 'canonical_calendar',
      generatedAt: nowIso(),
      items,
    };
    
    await redis.set(cacheKey, JSON.stringify(response), 'EX', appConfig.cache.calendarTtlSeconds);
    return response;
  }
}

function isItemInThisWeek(item: { AirDate?: string | null }): boolean {
  if (!item.AirDate) return false;
  const airDateMs = Date.parse(item.AirDate);
  if (!Number.isFinite(airDateMs)) return false;

  const now = Date.now();
  const nowDate = new Date(now);
  const startOfToday = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  const day = nowDate.getUTCDay();
  const startOfWeek = startOfToday - day * DAY_MS;
  const endOfWeek = startOfWeek + 7 * DAY_MS;

  return airDateMs >= startOfWeek && airDateMs < endOfWeek;
}
