import { redis } from '../../lib/redis.js';
import { appConfig } from '../../config/app-config.js';
import { nowIso } from '../../lib/time.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { recommendationConfig } from '../recommendations/recommendation-config.js';
import { RecommendationOutputService } from '../recommendations/recommendation-output.service.js';
import { PersonalMediaService } from '../watch/personal-media.service.js';
import { HomeBuilderService } from './home-builder.service.js';
import { homeCacheKey } from '../cache/cache-keys.js';
import type { HomeResponse } from './home.types.js';

export class HomeService {
  constructor(
    private readonly personalMediaService = new PersonalMediaService(),
    private readonly calendarService = new CalendarService(),
    private readonly recommendationOutputService = new RecommendationOutputService(),
    private readonly homeBuilderService = new HomeBuilderService(),
  ) {}

  async getHome(userId: string, profileId: string): Promise<HomeResponse> {
    const cacheKey = homeCacheKey(profileId);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as HomeResponse;
    }

    const [continueWatching, calendar] = await Promise.all([
      this.personalMediaService.listContinueWatchingProducts(userId, profileId, 20),
      this.calendarService.getCalendar(userId, profileId),
    ]);

    const generatedAt = nowIso();
    const runtime = this.homeBuilderService.build({
      continueWatching,
      calendarItems: calendar.items,
    });

    const activeRecommendation = await this.recommendationOutputService.getActiveRecommendationForAccount(
      userId,
      profileId,
      recommendationConfig.algorithmVersion,
    );

    const payload: HomeResponse = {
      profileId,
      source: 'canonical_home',
      generatedAt,
      runtime,
      snapshot: {
        sourceKey: activeRecommendation?.sourceKey ?? null,
        generatedAt: activeRecommendation?.generatedAt ?? null,
        sections: activeRecommendation?.sections ?? [],
      },
    };

    await redis.set(cacheKey, JSON.stringify(payload), 'EX', appConfig.cache.homeTtlSeconds);
    return payload;
  }
}
