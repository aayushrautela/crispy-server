import { withDbClient } from '../../lib/db.js';
import type { PublicRecommendationDto } from '../../http/contracts/account-public.js';
import type { AuthActor } from '../auth/auth.types.js';
import { PublicAccountAccessService } from './public-account-access.service.js';

export class PublicRecommendationReadService {
  constructor(private readonly accessService = new PublicAccountAccessService()) {}

  async getCurrentForProfile(actor: AuthActor, profileId: string): Promise<PublicRecommendationDto | null> {
    this.accessService.requireScope(actor, 'recommendations:read');
    
    return withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, actor, profileId);
      
      // Return null for now - recommendation storage not yet implemented
      return null;
    });
  }
}
