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
  return {
    rank: typeof item.rank === 'number' ? item.rank : index + 1,
    media: {
      mediaKey: `${String(item.provider ?? 'custom')}:${String(item.providerItemId ?? index)}`,
      mediaType: normalizeMediaType(String(item.mediaType ?? 'unknown')),
      title: typeof item.title === 'string' ? item.title : String(item.providerItemId ?? 'Untitled'),
      subtitle: null,
      year: null,
      posterUrl: typeof item.imageUrl === 'string' ? item.imageUrl : null,
      backdropUrl: null,
      runtimeMinutes: typeof item.durationMs === 'number' ? Math.round(item.durationMs / 60000) : null,
      rating: typeof item.score === 'number' ? item.score : null,
    },
    reason: typeof item.reason === 'string' ? item.reason : null,
  };
}

function normalizeMediaType(value: string): 'movie' | 'show' | 'season' | 'episode' | 'unknown' {
  if (value === 'episode') return 'episode';
  if (value === 'video') return 'movie';
  return 'unknown';
}
