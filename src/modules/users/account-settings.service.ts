import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AccountSettingsRepository } from './account-settings.repo.js';

export type AccountSecretField = 'ai.api_key' | 'metadata.omdb_api_key';

export type AccountSecretValue = {
  appUserId: string;
  key: AccountSecretField;
  value: string;
};

export type OmdbApiKeyLookup = {
  ownKeys: string[];
  pooledKeys: string[];
};

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

const ACCOUNT_SECRET_FIELDS = new Set<AccountSecretField>(['ai.api_key', 'metadata.omdb_api_key']);
const ACCOUNT_SCOPED_PROFILE_SETTING_KEYS = new Set(['ai.api_key', 'metadata.omdb_api_key', 'addons']);

export class AccountSettingsService {
  constructor(
    private readonly accountSettingsRepository = new AccountSettingsRepository(),
    private readonly profileRepository = new ProfileRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getSettings(userId: string): Promise<Record<string, unknown>> {
    return this.runInTransaction((client) => this.accountSettingsRepository.getSettingsForUser(client, userId));
  }

  async patchSettings(userId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const normalizedPatch = normalizeSettingsPatch(patch);
    return this.runInTransaction((client) => this.accountSettingsRepository.patchSettingsForUser(client, userId, normalizedPatch));
  }

  async getAiApiKeyForUser(userId: string): Promise<AccountSecretValue> {
    return this.getSecretForUser(userId, 'ai.api_key');
  }

  async getOmdbApiKeyForUser(userId: string): Promise<AccountSecretValue> {
    return this.getSecretForUser(userId, 'metadata.omdb_api_key');
  }

  async setAiApiKeyForUser(userId: string, value: string): Promise<AccountSecretValue> {
    return this.setSecretForUser(userId, 'ai.api_key', value);
  }

  async setOmdbApiKeyForUser(userId: string, value: string): Promise<AccountSecretValue> {
    return this.setSecretForUser(userId, 'metadata.omdb_api_key', value);
  }

  async listOmdbApiKeysForLookup(userId: string): Promise<OmdbApiKeyLookup> {
    return this.runInTransaction(async (client) => {
      const entries = await this.accountSettingsRepository.listSecretsForField(client, 'metadata.omdb_api_key');
      return {
        ownKeys: dedupeStrings(entries.filter((entry) => entry.appUserId === userId).map((entry) => entry.value)),
        pooledKeys: dedupeStrings(entries.filter((entry) => entry.appUserId !== userId).map((entry) => entry.value)),
      } satisfies OmdbApiKeyLookup;
    });
  }

  async clearAiApiKeyForUser(userId: string): Promise<boolean> {
    return this.clearSecretForUser(userId, 'ai.api_key');
  }

  async clearOmdbApiKeyForUser(userId: string): Promise<boolean> {
    return this.clearSecretForUser(userId, 'metadata.omdb_api_key');
  }

  async getSecretForUser(userId: string, field: string): Promise<AccountSecretValue> {
    return this.runInTransaction(async (client) => {
      const secretField = normalizeSecretField(field);
      const value = await this.accountSettingsRepository.getSecretForUser(client, userId, secretField);
      if (!value) {
        throw new HttpError(404, 'Account secret not found.');
      }
      return {
        appUserId: userId,
        key: secretField,
        value,
      } satisfies AccountSecretValue;
    });
  }

  async setSecretForUser(userId: string, field: string, value: string): Promise<AccountSecretValue> {
    const secretField = normalizeSecretField(field);
    const normalizedValue = normalizeSecretValue(value);
    return this.runInTransaction(async (client) => {
      await this.accountSettingsRepository.setSecretForUser(client, userId, secretField, normalizedValue);
      return {
        appUserId: userId,
        key: secretField,
        value: normalizedValue,
      } satisfies AccountSecretValue;
    });
  }

  async clearSecretForUser(userId: string, field: string): Promise<boolean> {
    const secretField = normalizeSecretField(field);
    return this.runInTransaction((client) => this.accountSettingsRepository.deleteSecretForUser(client, userId, secretField));
  }

  async getSecretForAccountProfile(accountId: string, profileId: string, field: string): Promise<AccountSecretValue> {
    return this.runInTransaction(async (client) => {
      const secretField = normalizeSecretField(field);
      const profile = await this.profileRepository.findByIdForOwnerUser(client, profileId, accountId);
      if (!profile) {
        throw new HttpError(404, 'Profile not found for account.');
      }

      const value = await this.accountSettingsRepository.getSecretForUser(client, accountId, secretField);
      if (!value) {
        throw new HttpError(404, 'Account secret not found.');
      }

      return {
        appUserId: accountId,
        key: secretField,
        value,
      } satisfies AccountSecretValue;
    });
  }
}

export function mergeAccountScopedSettings(
  accountSettings: Record<string, unknown>,
  options?: { hasAiApiKey?: boolean; hasOmdbApiKey?: boolean; aiEndpointUrl?: string },
): Record<string, unknown> {
  const merged = { ...accountSettings };
  if (options?.hasAiApiKey !== undefined || options?.aiEndpointUrl !== undefined) {
    merged.ai = {
      ...(isRecord(merged.ai) ? merged.ai : {}),
      ...(options?.hasAiApiKey !== undefined ? { hasAiApiKey: options.hasAiApiKey } : {}),
      ...(options?.aiEndpointUrl !== undefined ? { endpointUrl: options.aiEndpointUrl } : {}),
    };
  }
  if (options?.hasOmdbApiKey !== undefined) {
    merged.metadata = {
      ...(isRecord(merged.metadata) ? merged.metadata : {}),
      hasOmdbApiKey: options.hasOmdbApiKey,
    };
  }
  return merged;
}

export function stripAccountScopedProfileSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const next = { ...settings };
  for (const key of ACCOUNT_SCOPED_PROFILE_SETTING_KEYS) {
    delete next[key];
  }
  return next;
}

export function normalizeSettingsPatch(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, 'Settings patch must be an object.');
  }

  for (const key of Object.keys(value)) {
    if (ACCOUNT_SCOPED_PROFILE_SETTING_KEYS.has(key)) {
      throw new HttpError(400, `Setting '${key}' is account-scoped and must be updated on /v1/account/settings or /v1/account/secrets.`);
    }
  }

  return value;
}

function normalizeSecretField(field: string): AccountSecretField {
  if (!ACCOUNT_SECRET_FIELDS.has(field as AccountSecretField)) {
    throw new HttpError(403, 'Secret field not allowed.');
  }
  return field as AccountSecretField;
}

function normalizeSecretValue(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpError(400, 'Secret value is required.');
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
