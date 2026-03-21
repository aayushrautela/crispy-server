import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchHistoryQueryService } from '../watch/history.service.js';
import { CalendarService } from '../calendar/calendar.service.js';

export class HomeService {
  constructor(
    private readonly continueWatchingService = new ContinueWatchingService(),
    private readonly historyService = new WatchHistoryQueryService(),
    private readonly calendarService = new CalendarService(),
  ) {}

  async getHome(userId: string, profileId: string): Promise<Record<string, unknown>> {
    const cacheKey = `home:${profileId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Record<string, unknown>;
    }

    const [continueWatching, history, calendar] = await Promise.all([
      this.continueWatchingService.list(userId, profileId, 20),
      this.historyService.list(userId, profileId, 10),
      this.calendarService.getCalendar(userId, profileId),
    ]);

    const response = {
      sections: [
        {
          id: 'continue-watching',
          title: 'Continue Watching',
          items: continueWatching,
        },
        {
          id: 'recent-history',
          title: 'Recent History',
          items: history,
        },
        {
          id: 'calendar',
          title: 'This Week',
          items: calendar.items,
        },
      ],
    };

    await redis.set(cacheKey, JSON.stringify(response), 'EX', env.homeCacheTtlSeconds);
    return response;
  }
}
