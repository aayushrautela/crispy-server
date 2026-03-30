import { withTransaction, type DbClient } from '../../lib/db.js';
import { appConfig, isAiProviderId, normalizeAiProviderId } from '../../config/app-config.js';
import { HttpError } from '../../lib/errors.js';
import type { AiApiKeyLookup, AiClientSettings } from '../ai/ai.types.js';
import { buildAiClientSettings, getAiProviderIdFromSettings } from '../ai/ai-account-settings.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AccountSettingsRepository } from './account-settings.repo.js';

export type AccountSecretField = 'ai.api_key';

export type AccountSecretValue = {
  appUserId: string;
  key: AccountSecretField;
  value: string;
};

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

const ACCOUNT_SECRET_FIELDS = new Set<AccountSecretField>(['ai.api_key']);
const ACCOUNT_SECRET_SETTING_KEYS = new Set(['ai.api_key']);
const ACCOUNT_SCOPED_PROFILE_SETTING_KEYS = new Set(['ai', 'ai.api_key', 'addons']);

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
    const normalizedPatch = normalizeAccountSettingsPatch(patch);
    return this.runInTransaction((client) => this.accountSettingsRepository.patchSettingsForUser(client, userId, normalizedPatch));
  }

  async getAiApiKeyForUser(userId: string): Promise<AccountSecretValue> {
    return this.getSecretForUser(userId, 'ai.api_key');
  }

  async setAiApiKeyForUser(userId: string, value: string): Promise<AccountSecretValue> {
    return this.setSecretForUser(userId, 'ai.api_key', value);
  }

  async getAiProviderIdForUser(userId: string): Promise<string> {
    const settings = await this.getSettings(userId);
    return getAiProviderIdFromSettings(settings);
  }

  async getAiClientSettingsForUser(userId: string): Promise<AiClientSettings> {
    const settings = await this.getSettings(userId);
    const hasAiApiKey = await this.getAiApiKeyForUser(userId)
      .then(() => true)
      .catch(() => false);
    return buildAiClientSettings(settings, hasAiApiKey);
  }

  async listAiApiKeysForLookup(userId: string): Promise<AiApiKeyLookup> {
    return this.runInTransaction(async (client) => {
      const entries = await this.accountSettingsRepository.listAiSecretsForLookup(client, appConfig.ai.defaultProviderId);
      const normalized = dedupeAiApiKeyCandidates(entries.map((entry) => ({
        appUserId: entry.appUserId,
        providerId: normalizeAiProviderId(entry.providerId),
        apiKey: entry.apiKey,
      })));

      return {
        ownKeys: normalized
          .filter((entry) => entry.appUserId === userId)
          .map(({ providerId, apiKey }) => ({ providerId, apiKey })),
        pooledKeys: normalized
          .filter((entry) => entry.appUserId !== userId)
          .map(({ providerId, apiKey }) => ({ providerId, apiKey })),
      } satisfies AiApiKeyLookup;
    });
  }

  async clearAiApiKeyForUser(userId: string): Promise<boolean> {
    return this.clearSecretForUser(userId, 'ai.api_key');
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
  options?: { ai?: AiClientSettings; hasOmdbApiKey?: boolean },
): Record<string, unknown> {
  const merged = { ...accountSettings };
  if (options?.ai) {
    merged.ai = {
      ...(isRecord(merged.ai) ? merged.ai : {}),
      ...options.ai,
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

export function normalizeAccountSettingsPatch(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, 'Settings patch must be an object.');
  }

  const normalized = { ...value };

  for (const key of Object.keys(value)) {
    if (ACCOUNT_SECRET_SETTING_KEYS.has(key)) {
      throw new HttpError(400, `Setting '${key}' is secret and must be updated on /v1/account/secrets.`);
    }
  }

  if (Object.hasOwn(normalized, 'ai')) {
    const aiSettings = normalizeEditableAiSettings(normalized.ai);
    if (Object.keys(aiSettings).length > 0) {
      normalized.ai = aiSettings;
    } else {
      delete normalized.ai;
    }
  }

  if (Object.hasOwn(normalized, 'metadata')) {
    const metadataSettings = normalizeEditableMetadataSettings(normalized.metadata);
    if (Object.keys(metadataSettings).length > 0) {
      normalized.metadata = metadataSettings;
    } else {
      delete normalized.metadata;
    }
  }

  return normalized;
}

export function normalizeProfileSettingsPatch(value: unknown): Record<string, unknown> {
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

function dedupeAiApiKeyCandidates(values: Array<{ appUserId: string; providerId: string; apiKey: string }>): Array<{ appUserId: string; providerId: string; apiKey: string }> {
  const seen = new Set<string>();
  const deduped: Array<{ appUserId: string; providerId: string; apiKey: string }> = [];

  for (const value of values) {
    const providerId = value.providerId.trim();
    const apiKey = value.apiKey.trim();
    if (!providerId || !apiKey) {
      continue;
    }

    const key = `${value.appUserId}:${providerId}:${apiKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      appUserId: value.appUserId,
      providerId,
      apiKey,
    });
  }

  return deduped;
}

function normalizeEditableAiSettings(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, 'AI settings patch must be an object.');
  }

  const aiSettings = { ...value };
  delete aiSettings.hasAiApiKey;
  delete aiSettings.defaultProviderId;
  delete aiSettings.providers;
  delete aiSettings.endpointUrl;

  if (Object.hasOwn(aiSettings, 'providerId')) {
    const rawProviderId = typeof aiSettings.providerId === 'string'
      ? aiSettings.providerId.trim()
      : '';

    if (rawProviderId && !isAiProviderId(rawProviderId)) {
      throw new HttpError(400, 'AI provider is not supported.');
    }

    aiSettings.providerId = rawProviderId || appConfig.ai.defaultProviderId;
  }

  return aiSettings;
}

function normalizeEditableMetadataSettings(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, 'Metadata settings patch must be an object.');
  }

  const metadataSettings = { ...value };
  delete metadataSettings.hasOmdbApiKey;
  return metadataSettings;
}
