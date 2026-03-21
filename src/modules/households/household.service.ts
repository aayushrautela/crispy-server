import { env } from '../../config/env.js';
import type { DbClient } from '../../lib/db.js';
import { HouseholdRepository } from './household.repo.js';
import { ProfileRepository } from '../profiles/profile.repo.js';

export class HouseholdService {
  constructor(
    private readonly householdRepository = new HouseholdRepository(),
    private readonly profileRepository = new ProfileRepository(),
  ) {}

  async ensureDefaultHousehold(client: DbClient, params: { userId: string }): Promise<string> {
    const memberships = await this.householdRepository.findMembershipsForUser(client, params.userId);
    const existing = memberships[0]?.householdId;
    if (existing) {
      return existing;
    }

    const householdId = await this.householdRepository.createDefaultHousehold(client, {
      userId: params.userId,
      householdName: env.defaultHouseholdName,
    });

    await this.profileRepository.create(client, {
      householdId,
      name: env.defaultProfileName,
      sortOrder: 0,
      createdByUserId: params.userId,
    });

    return householdId;
  }

  async getPrimaryHouseholdId(client: DbClient, userId: string): Promise<string | null> {
    const memberships = await this.householdRepository.findMembershipsForUser(client, userId);
    return memberships[0]?.householdId ?? null;
  }
}
