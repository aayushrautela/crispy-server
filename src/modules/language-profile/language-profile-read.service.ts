import { withDbClient } from '../../lib/db.js';
import type { PublicLanguageProfileDto } from '../../http/contracts/account-public.js';
import type { AuthActor } from '../auth/auth.types.js';
import { PublicAccountAccessService } from '../account-public/public-account-access.service.js';
import { LanguageProfileRepository } from './language-profile.repo.js';

export class LanguageProfileReadService {
  constructor(
    private readonly accessService = new PublicAccountAccessService(),
    private readonly repo = new LanguageProfileRepository(),
  ) {}

  async getForProfile(actor: AuthActor, profileId: string): Promise<PublicLanguageProfileDto> {
    this.accessService.requireScope(actor, 'taste-profile:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      const profile = await this.repo.getByProfile(client, profileId);
      
      if (!profile) {
        return {
          profileId,
          status: 'pending',
          sampleSize: 0,
          windowSize: 50,
          computedAt: null,
          ratios: [],
          primaryLanguage: null,
        };
      }

      return {
        profileId: profile.profileId,
        status: profile.status,
        sampleSize: profile.sampleSize,
        windowSize: profile.windowSize,
        computedAt: profile.computedAt,
        ratios: profile.ratios,
        primaryLanguage: profile.primaryLanguage,
      };
    });
  }
}
