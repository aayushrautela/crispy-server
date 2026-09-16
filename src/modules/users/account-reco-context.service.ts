import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { UserRepository } from './user.repo.js';
import { AccountSettingsService, type PricingTier } from './account-settings.service.js';

export type AccountRecoContext = {
  accountId: string;
  pricingTier: PricingTier;
  lastSeenAt: string | null;
};

export class AccountRecoContextService {
  constructor(
    private readonly userRepository: UserRepository = new UserRepository(),
    private readonly accountSettingsService: AccountSettingsService = new AccountSettingsService(),
  ) {}

  async getForAccount(accountId: string): Promise<AccountRecoContext> {
    const user = await withDbClient((client) => this.userRepository.findById(client, accountId));
    if (!user) {
      throw new HttpError(404, 'Account not found.');
    }
    return {
      accountId,
      pricingTier: await this.accountSettingsService.getPricingTierForUser(accountId),
      lastSeenAt: user.lastSeenAt,
    };
  }
}
