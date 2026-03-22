import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchHistoryQueryService } from '../watch/history.service.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { HomeBuilderService } from './home-builder.service.js';
import type { HomeResponse } from './home.types.js';

export class HomeService {
  constructor(
    private readonly continueWatchingService = new ContinueWatchingService(),
    private readonly historyService = new WatchHistoryQueryService(),
    private readonly calendarService = new CalendarService(),
    private readonly homeBuilderService = new HomeBuilderService(),
  ) {}

  async getHome(userId: string, profileId: string): Promise<HomeResponse> {
    const cacheKey = `home:${profileId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as HomeResponse;
    }

    const [continueWatching, history, calendar] = await Promise.all([
      this.continueWatchingService.list(userId, profileId, 20),
      this.historyService.list(userId, profileId, 10),
      this.calendarService.getCalendar(userId, profileId),
    ]);

    const response = this.homeBuilderService.build({
      continueWatching,
      history,
      calendarItems: calendar.items,
    });

    await redis.set(cacheKey, JSON.stringify(response), 'EX', env.homeCacheTtlSeconds);
    return response;
  }
}
