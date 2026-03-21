import { withTransaction } from '../../lib/db.js';
import { UserRepository } from './user.repo.js';
import { HouseholdService } from '../households/household.service.js';
import type { AuthContext } from './user.types.js';

export class UserService {
  constructor(
    private readonly userRepository = new UserRepository(),
    private readonly householdService = new HouseholdService(),
  ) {}

  async ensureAppUser(params: { supabaseAuthUserId: string; email: string | null }): Promise<AuthContext> {
    return withTransaction(async (client) => {
      const user = await this.userRepository.upsertFromJwt(client, params);
      await this.householdService.ensureDefaultHousehold(client, { userId: user.id });
      return {
        appUserId: user.id,
        supabaseAuthUserId: user.supabaseAuthUserId,
        email: user.email,
      };
    });
  }
}
