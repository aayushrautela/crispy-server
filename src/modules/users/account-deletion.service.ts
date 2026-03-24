import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { PersonalAccessTokenService } from '../auth/personal-access-token.service.js';
import { ExternalAuthAdminService } from '../auth/external-auth-admin.service.js';
import { HouseholdRepository } from '../households/household.repo.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AccountSettingsRepository } from './account-settings.repo.js';
import { UserRepository } from './user.repo.js';

export type DeletedAccountResult = {
  appUserId: string;
  deletedOwnedHouseholds: number;
  transferredOwnedHouseholds: number;
  revokedPersonalAccessTokens: number;
  deletedExternalAuthUser: boolean;
  warnings: string[];
};

export class AccountDeletionService {
  constructor(
    private readonly personalAccessTokenService = new PersonalAccessTokenService(),
    private readonly householdRepository = new HouseholdRepository(),
    private readonly profileRepository = new ProfileRepository(),
    private readonly accountSettingsRepository = new AccountSettingsRepository(),
    private readonly userRepository = new UserRepository(),
    private readonly externalAuthAdminService = new ExternalAuthAdminService(),
  ) {}

  async deleteAccount(params: { appUserId: string; authSubject: string | null }): Promise<DeletedAccountResult> {
    const revokedPersonalAccessTokens = await this.personalAccessTokenService.revokeAllForUser(params.appUserId);
    const warnings: string[] = [];

    const deletion = await withTransaction(async (client) => {
      const ownedHouseholdIds = await this.householdRepository.findOwnedHouseholdIds(client, params.appUserId);
      let deletedOwnedHouseholds = 0;
      let transferredOwnedHouseholds = 0;

      for (const householdId of ownedHouseholdIds) {
        const members = await this.householdRepository.listMembers(client, householdId);
        const nextOwner = members.find((member) => member.userId !== params.appUserId);
        if (nextOwner) {
          await this.householdRepository.transferOwnership(client, {
            householdId,
            nextOwnerUserId: nextOwner.userId,
          });
          transferredOwnedHouseholds += 1;
          continue;
        }

        const avatarKeys = await this.profileRepository.listAvatarKeysForHouseholds(client, [householdId]);

        const deleted = await this.householdRepository.deleteById(client, householdId);
        if (deleted) {
          deletedOwnedHouseholds += 1;
          if (avatarKeys.length > 0) {
            warnings.push(
              `Deleted household ${householdId} referenced ${avatarKeys.length} avatar key(s), but avatar storage cleanup is not configured locally.`,
            );
          }
        } else {
          warnings.push(`Unable to delete empty household ${householdId}.`);
        }
      }

      await client.query('DELETE FROM account_secrets WHERE app_user_id = $1::uuid', [params.appUserId]);
      await client.query('DELETE FROM account_settings WHERE app_user_id = $1::uuid', [params.appUserId]);

      const deletedUser = await this.userRepository.deleteById(client, params.appUserId);
      if (!deletedUser) {
        throw new HttpError(404, 'Account not found.');
      }

      return { deletedOwnedHouseholds, transferredOwnedHouseholds };
    });

    let deletedExternalAuthUser = false;
    if (params.authSubject) {
      deletedExternalAuthUser = await this.externalAuthAdminService.deleteUser(params.authSubject);
    }

    return {
      appUserId: params.appUserId,
      deletedOwnedHouseholds: deletion.deletedOwnedHouseholds,
      transferredOwnedHouseholds: deletion.transferredOwnedHouseholds,
      revokedPersonalAccessTokens,
      deletedExternalAuthUser,
      warnings,
    };
  }
}
