import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AiClientSettings } from '../ai/ai.types.js';
import { buildAiClientSettings, getAiProviderIdFromSettings } from '../ai/ai-account-settings.js';
import { ProfileRepository } from '../profiles/profile.repo.js';
import { AccountSettingsRepository } from './account-settings.repo.js';

export type AccountSecretField = 'ai.api_key' | 'mdblist.api_key';

export type AccountSecretValue = {
  appUserId: string;
  key: AccountSecretField;
  value: string;
};

export type PricingTier = 'free' | 'lite' | 'pro' | 'ultra';

const DEFAULT_PRICING_TIER: PricingTier = 'free';
const PRICING_TIERS = new Set<PricingTier>(['free', 'lite', 'pro', 'ultra']);

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

const ACCOUNT_SECRET_FIELDS = new Set<AccountSecretField>(['ai.api_key', 'mdblist.api_key']);
const ACCOUNT_SECRET_SETTING_KEYS = new Set(['ai.api_key', 'mdblist.api_key']);
const ACCOUNT_SCOPED_PROFILE_SETTING_KEYS = new Set(['ai', 'ai.api_key', 'mdblist.api_key', 'addons']);

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

  async getMdbListApiKeyForUser(userId: string): Promise<AccountSecretValue> {
    return this.getSecretForUser(userId, 'mdblist.api_key');
  }

  async setMdbListApiKeyForUser(userId: string, value: string): Promise<AccountSecretValue> {
    return this.setSecretForUser(userId, 'mdblist.api_key', value);
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

  async getPricingTierForUser(userId: string): Promise<PricingTier> {
    const settings = await this.getSettings(userId);
    return normalizePricingTier(settings.pricingTier ?? DEFAULT_PRICING_TIER);
  }

  async setPricingTierForUser(userId: string, pricingTier: unknown): Promise<PricingTier> {
    const normalizedPricingTier = normalizePricingTier(pricingTier);
    await this.runInTransaction((client) => this.accountSettingsRepository.patchSettingsForUser(client, userId, {
      pricingTier: normalizedPricingTier,
    }));
    return normalizedPricingTier;
  }

  async clearAiApiKeyForUser(userId: string): Promise<boolean> {
    return this.clearSecretForUser(userId, 'ai.api_key');
  }

  async clearMdbListApiKeyForUser(userId: string): Promise<boolean> {
    return this.clearSecretForUser(userId, 'mdblist.api_key');
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
  options?: { ai?: AiClientSettings; hasMdbListAccess?: boolean; pricingTier?: PricingTier },
): Record<string, unknown> {
  const merged = { ...accountSettings };
  if (options?.ai) {
    merged.ai = {
      ...(isRecord(merged.ai) ? merged.ai : {}),
      ...options.ai,
    };
  }
  if (options?.hasMdbListAccess !== undefined) {
    merged.metadata = {
      ...(isRecord(merged.metadata) ? merged.metadata : {}),
      hasMdbListAccess: options.hasMdbListAccess,
    };
  }
  merged.pricingTier = options?.pricingTier ?? DEFAULT_PRICING_TIER;
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

  delete normalized.pricingTier;

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

function normalizePricingTier(value: unknown): PricingTier {
  if (typeof value !== 'string' || !PRICING_TIERS.has(value as PricingTier)) {
    throw new HttpError(400, 'Pricing tier must be one of free, lite, pro, ultra.');
  }
  return value as PricingTier;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    delete aiSettings.providerId;
  }

  return aiSettings;
}

function normalizeEditableMetadataSettings(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, 'Metadata settings patch must be an object.');
  }

  const metadataSettings = { ...value };
  delete metadataSettings.hasMdbListAccess;
  return metadataSettings;
}
