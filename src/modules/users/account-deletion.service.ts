import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { PersonalAccessTokenService } from '../auth/personal-access-token.service.js';
import { ExternalAuthAdminService } from '../auth/external-auth-admin.service.js';
import { HouseholdRepository } from '../households/household.repo.js';
import { UserRepository } from './user.repo.js';

export type DeletedAccountResult = {
  appUserId: string;
  deletedOwnedHouseholds: number;
  revokedPersonalAccessTokens: number;
  deletedExternalAuthUser: boolean;
};

export class AccountDeletionService {
  constructor(
    private readonly personalAccessTokenService = new PersonalAccessTokenService(),
    private readonly householdRepository = new HouseholdRepository(),
    private readonly userRepository = new UserRepository(),
    private readonly externalAuthAdminService = new ExternalAuthAdminService(),
  ) {}

  async deleteAccount(params: { appUserId: string; authSubject: string | null }): Promise<DeletedAccountResult> {
    const revokedPersonalAccessTokens = await this.personalAccessTokenService.revokeAllForUser(params.appUserId);

    const deletion = await withTransaction(async (client) => {
      const deletedOwnedHouseholds = await this.householdRepository.deleteOwnedByUser(client, params.appUserId);
      const deletedUser = await this.userRepository.deleteById(client, params.appUserId);
      if (!deletedUser) {
        throw new HttpError(404, 'Account not found.');
      }

      return { deletedOwnedHouseholds };
    });

    let deletedExternalAuthUser = false;
    if (params.authSubject) {
      deletedExternalAuthUser = await this.externalAuthAdminService.deleteUser(params.authSubject);
    }

    return {
      appUserId: params.appUserId,
      deletedOwnedHouseholds: deletion.deletedOwnedHouseholds,
      revokedPersonalAccessTokens,
      deletedExternalAuthUser,
    };
  }
}
