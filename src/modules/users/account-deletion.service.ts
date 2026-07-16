import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { PersonalAccessTokenService } from '../auth/personal-access-token.service.js';
import { ExternalAuthAdminService } from '../auth/external-auth-admin.service.js';
import { UserRepository } from './user.repo.js';

export type DeletedAccountResult = {
  appUserId: string;
  deletedProfiles: number;
  revokedPersonalAccessTokens: number;
  deletedExternalAuthUser: boolean;
  warnings: string[];
};

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class AccountDeletionService {
  constructor(
    private readonly personalAccessTokenService = new PersonalAccessTokenService(),
    private readonly userRepository = new UserRepository(),
    private readonly externalAuthAdminService = new ExternalAuthAdminService(),
    private readonly transactionRunner: TransactionRunner = withTransaction,
  ) {}

  async deleteAccount(params: { appUserId: string; authSubject: string | null }): Promise<DeletedAccountResult> {
    const revokedPersonalAccessTokens = await this.personalAccessTokenService.revokeAllForUser(params.appUserId);
    const warnings: string[] = [];

    const deletion = await this.transactionRunner(async (client) => {
      const avatarResult = await client.query(
        `SELECT avatar_url
         FROM identity.profiles
         WHERE account_id = $1::uuid
           AND avatar_url IS NOT NULL
           AND btrim(avatar_url) <> ''`,
        [params.appUserId],
      );
      const avatarUrls = avatarResult.rows.map((row) => String(row.avatar_url));

      await client.query('DELETE FROM private.account_secrets WHERE account_id = $1::uuid', [params.appUserId]);
      await client.query('DELETE FROM identity.account_preferences WHERE account_id = $1::uuid', [params.appUserId]);
      const profileResult = await client.query('DELETE FROM identity.profiles WHERE account_id = $1::uuid RETURNING id', [params.appUserId]);

      if (avatarUrls.length > 0) {
        warnings.push(
          `Deleted account referenced ${avatarUrls.length} external avatar URL(s); no local avatar storage cleanup is configured.`,
        );
      }

      const deletedUser = await this.userRepository.deleteById(client, params.appUserId);
      if (!deletedUser) {
        throw new HttpError(404, 'Account not found.');
      }

      return { deletedProfiles: profileResult.rowCount ?? 0 };
    });

    let deletedExternalAuthUser = false;
    if (params.authSubject) {
      deletedExternalAuthUser = await this.externalAuthAdminService.deleteUser(params.authSubject);
    }

    return {
      appUserId: params.appUserId,
      deletedProfiles: deletion.deletedProfiles,
      revokedPersonalAccessTokens,
      deletedExternalAuthUser,
      warnings,
    };
  }
}
