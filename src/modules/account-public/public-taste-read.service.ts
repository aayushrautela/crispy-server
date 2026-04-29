import { withDbClient } from '../../lib/db.js';
import type { PublicTasteDto } from '../../http/contracts/account-public.js';
import type { AuthActor } from '../auth/auth.types.js';
import { TasteProfileRepository } from '../recommendations/taste-profile.repo.js';
import { PublicAccountAccessService } from './public-account-access.service.js';
import { PublicTasteWriteRepo } from './public-taste-write.repo.js';

export class PublicTasteReadService {
  constructor(
    private readonly accessService = new PublicAccountAccessService(),
    private readonly tasteProfileRepo = new TasteProfileRepository(),
    private readonly publicTasteRepo = new PublicTasteWriteRepo(),
  ) {}

  async getCurrentForProfile(actor: AuthActor, profileId: string): Promise<PublicTasteDto | null> {
    this.accessService.requireScope(actor, 'taste-profile:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      if (actor.appUserId) {
        const publicTaste = await this.publicTasteRepo.getCurrentTaste(client, {
          accountId: actor.appUserId,
          profileId,
        });
        if (publicTaste) {
          return {
            id: publicTaste.id,
            profileId: publicTaste.profileId,
            computedAt: publicTaste.updatedAt,
            summary: publicTaste.summary,
            genres: publicTaste.signalsJson
              .filter((signal): signal is { kind: string; label?: string; key?: string; weight: number } => typeof signal === 'object' && signal !== null && 'weight' in signal)
              .filter((signal) => signal.kind === 'genre' || signal.kind === 'mood' || signal.kind === 'tag')
              .slice(0, 20)
              .map((signal) => ({ name: signal.label ?? signal.key ?? signal.kind, weight: signal.weight })),
          };
        }
      }

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
