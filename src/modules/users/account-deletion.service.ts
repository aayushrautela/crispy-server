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
      await client.query('DELETE FROM private.account_secrets WHERE account_id = $1::uuid', [params.appUserId]);
      await client.query('DELETE FROM identity.account_preferences WHERE account_id = $1::uuid', [params.appUserId]);
      const profileResult = await client.query('DELETE FROM identity.profiles WHERE account_id = $1::uuid RETURNING id', [params.appUserId]);

      const deletedUser = await this.userRepository.deleteById(client, params.appUserId);
      if (!deletedUser) {
        throw new HttpError(404, 'Account not found.');
      }

      // Self-heal deletion from the authoritative auth source via a direct DB
      // delete, mirroring the lookup self-heal. Clear non-cascading auth state
      // (flow_state) then delete auth.users (which cascades to sessions,
      // refresh_tokens, identities, mfa_factors, etc.).
      let deletedAuthUser = false;
      if (params.authSubject) {
        deletedAuthUser = await this.userRepository.deleteAuthUser(client, params.authSubject);
      }

      return { deletedProfiles: profileResult.rowCount ?? 0, deletedAuthUser };
    });

    // Fallback to the HTTP auth-admin API if the direct DB delete did not remove
    // the auth user (e.g. permissions or replication visibility). Uniform with
    // the lookup self-heal, which prefers the direct auth.users source.
    let deletedExternalAuthUser = deletion.deletedAuthUser;
    if (params.authSubject && !deletedExternalAuthUser) {
      try {
        deletedExternalAuthUser = await this.externalAuthAdminService.deleteUser(params.authSubject);
      } catch (error) {
        warnings.push(`HTTP auth-admin delete failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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
