import { withDbClient } from '../../lib/db.js';
import type { PublicTasteDto } from '../../http/contracts/account-public.js';
import type { AuthActor } from '../auth/auth.types.js';
import { TasteProfileRepository } from '../recommendations/taste-profile.repo.js';
import { PublicAccountAccessService } from './public-account-access.service.js';

export class PublicTasteReadService {
  constructor(
    private readonly accessService = new PublicAccountAccessService(),
    private readonly tasteProfileRepo = new TasteProfileRepository(),
  ) {}

  async getCurrentForProfile(actor: AuthActor, profileId: string): Promise<PublicTasteDto | null> {
    this.accessService.requireScope(actor, 'taste-profile:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      const profiles = await this.tasteProfileRepo.listForProfile(client, profileId);
      const latest = profiles[0];
      
      if (!latest) {
        return null;
      }

      const genres = Array.isArray(latest.genres)
        ? latest.genres
            .filter((g): g is { name: string; weight: number } => 
              typeof g === 'object' && g !== null && 'name' in g && 'weight' in g
            )
            .slice(0, 10)
        : [];

      return {
        id: `${latest.profileId}:${latest.sourceKey}`,
        profileId: latest.profileId,
        computedAt: latest.updatedAt,
        summary: latest.aiSummary,
        genres,
      };
    });
  }
}
