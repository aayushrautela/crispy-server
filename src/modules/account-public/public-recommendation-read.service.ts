import { withDbClient } from '../../lib/db.js';
import type { PublicRecommendationDto, PublicMediaItemDto } from '../../http/contracts/account-public.js';
import type { AuthActor } from '../auth/auth.types.js';
import { PublicAccountAccessService } from './public-account-access.service.js';
import { PublicRecommendationWriteRepo } from './public-recommendation-write.repo.js';

export class PublicRecommendationReadService {
  constructor(
    private readonly accessService = new PublicAccountAccessService(),
    private readonly publicRecommendationRepo = new PublicRecommendationWriteRepo(),
  ) {}

  async getCurrentForProfile(actor: AuthActor, profileId: string, listKey = 'external:current'): Promise<PublicRecommendationDto | null> {
    this.accessService.requireScope(actor, 'recommendations:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      if (!actor.appUserId) return null;
      const publicList = await this.publicRecommendationRepo.getCurrentList(client, {
        accountId: actor.appUserId,
        profileId,
        listKey,
      });
      if (!publicList) return null;
      return {
        id: publicList.id,
        profileId,
        title: publicList.summary,
        generatedAt: publicList.updatedAt,
        items: publicList.itemsJson.map((raw, index) => mapPublicRecommendationItem(raw, index)),
      };
    });
  }
}

function mapPublicRecommendationItem(raw: unknown, index: number): { rank: number; media: PublicMediaItemDto; reason: string | null } {
  const item = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const type = item.type === 'movie' || item.type === 'tv' ? item.type : 'unknown';
  const tmdbId = typeof item.tmdbId === 'number' && Number.isSafeInteger(item.tmdbId) ? item.tmdbId : index;
  const mediaKey = typeof item.mediaKey === 'string' ? item.mediaKey : `${type}:tmdb:${tmdbId}`;
  return {
    rank: typeof item.rank === 'number' ? item.rank : index + 1,
    media: {
      mediaKey,
      mediaType: normalizeMediaType(type),
      title: mediaKey,
      subtitle: null,
      year: null,
      posterUrl: null,
      backdropUrl: null,
      runtimeMinutes: null,
      rating: null,
    },
    reason: null,
  };
}

function normalizeMediaType(value: string): 'movie' | 'show' | 'season' | 'episode' | 'unknown' {
  if (value === 'movie') return 'movie';
  if (value === 'tv') return 'show';
  return 'unknown';
}
