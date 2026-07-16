import { createHash } from 'node:crypto';
import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { AccountSettingsRepository } from './account-settings.repo.js';

export type AccountSecretField = 'mdblist.api_key';

export type AccountSecretValue = {
  appUserId: string;
  key: AccountSecretField;
  value: string;
};

export type AccountSecretMetadata = {
  appUserId: string;
  key: AccountSecretField;
  present: boolean;
  fingerprint: string;
};

export type PricingTier = 'free' | 'lite' | 'pro' | 'ultra';

const DEFAULT_PRICING_TIER: PricingTier = 'free';
const PRICING_TIERS = new Set<PricingTier>(['free', 'lite', 'pro', 'ultra']);

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

const ACCOUNT_SECRET_FIELDS = ['mdblist.api_key'] as const satisfies readonly AccountSecretField[];
const ACCOUNT_SECRET_FIELD_SET = new Set<AccountSecretField>(ACCOUNT_SECRET_FIELDS);
const ACCOUNT_SECRET_SETTING_KEYS = new Set<string>(ACCOUNT_SECRET_FIELDS);
const ACCOUNT_SCOPED_PROFILE_SETTING_KEYS = new Set(['addons']);

export class AccountSettingsService {
  constructor(
    private readonly accountSettingsRepository: AccountSettingsRepository = new AccountSettingsRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async getSettings(userId: string): Promise<Record<string, unknown>> {
    return this.runInTransaction((client) => this.accountSettingsRepository.getSettingsForUser(client, userId));
  }

  async patchSettings(userId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const normalizedPatch = normalizeAccountSettingsPatch(patch);
    return this.runInTransaction((client) => this.accountSettingsRepository.patchSettingsForUser(client, userId, normalizedPatch));
  }

  async getMdbListApiKeyForUser(userId: string): Promise<AccountSecretValue> {
    return this.getSecretForUser(userId, 'mdblist.api_key');
  }

  async getMdbListApiKeyMetadataForUser(userId: string): Promise<AccountSecretMetadata> {
    return this.getSecretMetadataForUser(userId, 'mdblist.api_key');
  }

  async setMdbListApiKeyForUser(userId: string, value: string): Promise<AccountSecretMetadata> {
    return this.setSecretForUser(userId, 'mdblist.api_key', value);
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

  async setSecretForUser(userId: string, field: string, value: string): Promise<AccountSecretMetadata> {
    const secretField = normalizeSecretField(field);
    const normalizedValue = normalizeSecretValue(value);
    return this.runInTransaction(async (client) => {
      await this.accountSettingsRepository.setSecretForUser(client, userId, secretField, normalizedValue);
      return buildSecretMetadata(userId, secretField, normalizedValue);
    });
  }

  async getSecretMetadataForUser(userId: string, field: string): Promise<AccountSecretMetadata> {
    const secret = await this.getSecretForUser(userId, field);
    return buildSecretMetadata(userId, secret.key, secret.value);
  }

  async clearSecretForUser(userId: string, field: string): Promise<boolean> {
    const secretField = normalizeSecretField(field);
    return this.runInTransaction((client) => this.accountSettingsRepository.deleteSecretForUser(client, userId, secretField));
  }

  async getSecretForAccountProfile(accountId: string, _profileId: string, field: string): Promise<AccountSecretValue> {
    return this.getSecretForUser(accountId, field);
  }
}

export function mergeAccountScopedSettings(
  accountSettings: Record<string, unknown>,
  options?: { hasMdbListAccess?: boolean; pricingTier?: PricingTier },
): Record<string, unknown> {
  const merged = { ...accountSettings };
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

  const normalized = { ...value };
  if (Object.hasOwn(normalized, 'recommendations')) {
    normalized.recommendations = normalizeEditableRecommendationSettings(normalized.recommendations);
  }

  return normalized;
}

function normalizeSecretField(field: string): AccountSecretField {
  if (!ACCOUNT_SECRET_FIELD_SET.has(field as AccountSecretField)) {
    throw new HttpError(403, 'Secret field not allowed.');
  }
  return field as AccountSecretField;
}

function buildSecretMetadata(userId: string, key: AccountSecretField, value: string): AccountSecretMetadata {
  const fingerprint = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return {
    appUserId: userId,
    key,
    present: true,
    fingerprint,
  };
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

function normalizeEditableRecommendationSettings(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, 'Recommendation settings patch must be an object.');
  }

  const normalized: Record<string, unknown> = {};
  if (Object.hasOwn(value, 'useOfficialEngine')) {
    if (typeof value.useOfficialEngine !== 'boolean') {
      throw new HttpError(400, 'recommendations.useOfficialEngine must be a boolean.');
    }
    normalized.useOfficialEngine = value.useOfficialEngine;
  }
  if (Object.hasOwn(value, 'enabled')) {
    if (typeof value.enabled !== 'boolean') {
      throw new HttpError(400, 'recommendations.enabled must be a boolean.');
    }
    normalized.enabled = value.enabled;
  }
  return normalized;
}

function normalizeEditableMetadataSettings(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, 'Metadata settings patch must be an object.');
  }

  const metadataSettings = { ...value };
  delete metadataSettings.hasMdbListAccess;
  return metadataSettings;
}
