import { withTransaction } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { PersonalAccessTokenService } from '../auth/personal-access-token.service.js';
import { ExternalAuthAdminService } from '../auth/external-auth-admin.service.js';
import { ProfileGroupRepository } from '../profile-groups/profile-group.repo.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AccountSettingsRepository } from './account-settings.repo.js';
import { UserRepository } from './user.repo.js';

export type DeletedAccountResult = {
  appUserId: string;
  deletedProfileGroups: number;
  transferredProfileGroups: number;
  revokedPersonalAccessTokens: number;
  deletedExternalAuthUser: boolean;
  warnings: string[];
};

export class AccountDeletionService {
  constructor(
    private readonly personalAccessTokenService = new PersonalAccessTokenService(),
    private readonly profileGroupRepository = new ProfileGroupRepository(),
    private readonly profileRepository = new ProfileRepository(),
    private readonly accountSettingsRepository = new AccountSettingsRepository(),
    private readonly userRepository = new UserRepository(),
    private readonly externalAuthAdminService = new ExternalAuthAdminService(),
  ) {}

  async deleteAccount(params: { appUserId: string; authSubject: string | null }): Promise<DeletedAccountResult> {
    const revokedPersonalAccessTokens = await this.personalAccessTokenService.revokeAllForUser(params.appUserId);
    const warnings: string[] = [];

    const deletion = await withTransaction(async (client) => {
      const ownedProfileGroupIds = await this.profileGroupRepository.findOwnedProfileGroupIds(client, params.appUserId);
      let deletedOwnedProfileGroups = 0;
      let transferredOwnedProfileGroups = 0;

      for (const profileGroupId of ownedProfileGroupIds) {
        const members = await this.profileGroupRepository.listMembers(client, profileGroupId);
        const nextOwner = members.find((member) => member.userId !== params.appUserId);
        if (nextOwner) {
          await this.profileGroupRepository.transferOwnership(client, {
            profileGroupId,
            nextOwnerUserId: nextOwner.userId,
          });
          transferredOwnedProfileGroups += 1;
          continue;
        }

        const avatarKeys = await this.profileRepository.listAvatarKeysForProfileGroups(client, [profileGroupId]);

        const deleted = await this.profileGroupRepository.deleteById(client, profileGroupId);
        if (deleted) {
          deletedOwnedProfileGroups += 1;
          if (avatarKeys.length > 0) {
            warnings.push(
              `Deleted profile group ${profileGroupId} referenced ${avatarKeys.length} avatar key(s), but avatar storage cleanup is not configured locally.`,
            );
          }
        } else {
          warnings.push(`Unable to delete empty profile group ${profileGroupId}.`);
        }
      }

      await client.query('DELETE FROM account_secrets WHERE app_user_id = $1::uuid', [params.appUserId]);
      await client.query('DELETE FROM account_settings WHERE app_user_id = $1::uuid', [params.appUserId]);

      const deletedUser = await this.userRepository.deleteById(client, params.appUserId);
      if (!deletedUser) {
        throw new HttpError(404, 'Account not found.');
      }

      return { deletedOwnedProfileGroups, transferredOwnedProfileGroups };
    });

    let deletedExternalAuthUser = false;
    if (params.authSubject) {
      deletedExternalAuthUser = await this.externalAuthAdminService.deleteUser(params.authSubject);
    }

    return {
      appUserId: params.appUserId,
      deletedProfileGroups: deletion.deletedOwnedProfileGroups,
      transferredProfileGroups: deletion.transferredOwnedProfileGroups,
      revokedPersonalAccessTokens,
      deletedExternalAuthUser,
      warnings,
    };
  }
}
