import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchHistoryQueryService } from '../watch/history.service.js';

export class CalendarService {
  constructor(
    private readonly continueWatchingService = new ContinueWatchingService(),
    private readonly historyService = new WatchHistoryQueryService(),
  ) {}

  async getCalendar(userId: string, profileId: string): Promise<Record<string, unknown>> {
    const cacheKey = `calendar:${profileId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Record<string, unknown>;
    }

    const [continueWatching, history] = await Promise.all([
      this.continueWatchingService.list(userId, profileId, 10),
      this.historyService.list(userId, profileId, 20),
    ]);

    const items = [...continueWatching.slice(0, 5), ...history.slice(0, 5)].map((item, index) => ({
      bucket: index < continueWatching.length ? 'continue_watching' : 'history',
      ...item,
    }));

    const response = {
      generatedAt: new Date().toISOString(),
      items,
    };

    await redis.set(cacheKey, JSON.stringify(response), 'EX', env.calendarCacheTtlSeconds);
    return response;
  }
}
