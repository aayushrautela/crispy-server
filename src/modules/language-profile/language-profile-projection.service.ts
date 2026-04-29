import type { DbClient } from '../../lib/db.js';
import { LanguageProfileRepository } from './language-profile.repo.js';
import type { ProfileLanguageProfile, LanguageRatio } from './language-profile.types.js';

export class LanguageProfileProjectionService {
  constructor(private readonly repo = new LanguageProfileRepository()) {}

  async recomputeForProfile(client: DbClient, profileId: string, windowSize = 50): Promise<ProfileLanguageProfile> {
    const recentWatched = await this.repo.listRecentWatchedLanguages(client, profileId, windowSize);
    
    const languageCounts = new Map<string, number>();
    let totalWithLanguage = 0;

    for (const item of recentWatched) {
      if (item.language) {
        languageCounts.set(item.language, (languageCounts.get(item.language) ?? 0) + 1);
        totalWithLanguage++;
      }
    }

    if (totalWithLanguage === 0) {
      await this.repo.upsertComputed(client, {
        profileId,
        status: 'empty',
        windowSize,
        sampleSize: 0,
        ratios: [],
        primaryLanguage: null,
      });

      return {
        profileId,
        status: 'empty',
        windowSize,
        sampleSize: 0,
        ratios: [],
        primaryLanguage: null,
        computedAt: new Date().toISOString(),
      };
    }

    const ratios: LanguageRatio[] = Array.from(languageCounts.entries())
      .map(([language, count]) => ({
        language,
        count,
        ratio: parseFloat((count / totalWithLanguage).toFixed(4)),
      }))
      .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));

    const primaryLanguage = ratios[0]?.language ?? null;

    await this.repo.upsertComputed(client, {
      profileId,
      status: 'ready',
      windowSize,
      sampleSize: totalWithLanguage,
      ratios,
      primaryLanguage,
    });

    return {
      profileId,
      status: 'ready',
      windowSize,
      sampleSize: totalWithLanguage,
      ratios,
      primaryLanguage,
      computedAt: new Date().toISOString(),
    };
  }

  async markPending(client: DbClient, profileId: string): Promise<void> {
    await this.repo.upsertPending(client, profileId);
  }
}
