import { redis } from '../../lib/redis.js';
import { appConfig } from '../../config/app-config.js';
import { nowIso } from '../../lib/time.js';
import { ContinueWatchingService } from '../watch/continue-watching.service.js';
import { WatchedQueryService } from '../watch/watched.service.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { RecommendationOutputService } from '../recommendations/recommendation-output.service.js';
import { HomeBuilderService } from './home-builder.service.js';
import type { HomeResponse } from './home.types.js';

export class HomeService {
  constructor(
    private readonly continueWatchingService = new ContinueWatchingService(),
    private readonly watchedService = new WatchedQueryService(),
    private readonly calendarService = new CalendarService(),
    private readonly recommendationOutputService = new RecommendationOutputService(),
    private readonly homeBuilderService = new HomeBuilderService(),
  ) {}

  async getHome(userId: string, profileId: string): Promise<HomeResponse> {
    const cacheKey = `home:v2:${profileId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as HomeResponse;
    }

    const [continueWatching, history, calendar] = await Promise.all([
      this.continueWatchingService.list(userId, profileId, 20),
      this.watchedService.list(userId, profileId, 10),
      this.calendarService.getCalendar(userId, profileId),
    ]);

    const generatedAt = nowIso();
    const response = this.homeBuilderService.build({
      continueWatching,
      history,
      calendarItems: calendar.items,
    });

    const activeRecommendation = await this.recommendationOutputService.getActiveRecommendationForAccount(userId, profileId, 'default');
    if (activeRecommendation?.sections.length) {
      response.sections = [
        ...response.sections,
        ...activeRecommendation.sections.map((section) => ({
          id: section.id,
          title: section.title,
          kind: 'recommendation' as const,
          source: 'recommendation' as const,
          items: section.items,
          meta: section.meta,
        })),
      ];
    }

    const payload: HomeResponse = {
      profileId,
      source: 'canonical_home',
      generatedAt,
      sections: response.sections,
    };

    await redis.set(cacheKey, JSON.stringify(payload), 'EX', appConfig.cache.homeTtlSeconds);
    return payload;
  }
}
