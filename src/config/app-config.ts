import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AiCredentialSource, AiFeatureId, AiProviderView } from '../modules/ai/ai.types.js';

type AiProviderSelection =
  | { type: 'account' }
  | { type: 'fixed'; providerId: string };

type AiFeaturePolicyStep = {
  source: AiCredentialSource;
  provider: AiProviderSelection;
  models?: string[];
};

type AiFeaturePolicy = {
  fallback: AiFeaturePolicyStep[];
};

export type AppAiProviderConfig = AiProviderView & {
  models: Record<AiFeatureId, string>;
};

type AppConfig = {
  defaults: {
    profileGroupName: string;
    profileName: string;
  };
  cache: {
    calendarTtlSeconds: number;
    tmdb: {
      movieTtlHours: number;
      showTtlHours: number;
      seasonTtlHours: number;
    };
  };
  metadata: {
    tmdb: {
      baseUrl: string;
      imageBaseUrl: string;
    };
  };
  ai: {
    defaultProviderId: string;
    providers: Record<string, AppAiProviderConfig>;
    providerOrder: string[];
    features: Record<AiFeatureId, AiFeaturePolicy>;
    serverFallback: {
      transientCooldownSeconds: number[];
      rateLimitCooldownSeconds: number[];
      providerBlockSeconds: number;
    };
  };
};

const CREDENTIAL_SOURCES: AiCredentialSource[] = ['user', 'server', 'shared_pool'];

export const appConfigPath = resolveAppConfigPath();
export const appConfig = loadAppConfig(appConfigPath);

export function listAiProviders(): AppAiProviderConfig[] {
  return appConfig.ai.providerOrder.flatMap((providerId) => {
    const provider = appConfig.ai.providers[providerId];
    return provider ? [provider] : [];
  });
}

export function listPublicAiProviders(): AiProviderView[] {
  return listAiProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    endpointUrl: provider.endpointUrl,
  }));
}

export function isAiProviderId(value: string): boolean {
  return Object.hasOwn(appConfig.ai.providers, value);
}

export function normalizeAiProviderId(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return isAiProviderId(normalized) ? normalized : appConfig.ai.defaultProviderId;
}

export function requireAiProvider(providerId: string): AppAiProviderConfig {
  const provider = appConfig.ai.providers[normalizeAiProviderId(providerId)];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerId}`);
  }
  return provider;
}

export function getAiFeaturePolicy(feature: AiFeatureId): AiFeaturePolicy {
  return appConfig.ai.features[feature];
}

function resolveAppConfigPath(): string {
  const configuredPath = process.env.APP_CONFIG_PATH?.trim();
  if (configuredPath) {
    return path.resolve(process.cwd(), configuredPath);
  }

  const localPath = path.resolve(process.cwd(), 'config/app-config.json');
  const examplePath = path.resolve(process.cwd(), 'config/app-config.json.example');

  try {
    readFileSync(localPath, 'utf8');
    return localPath;
  } catch {
    return examplePath;
  }
}

function loadAppConfig(filePath: string): AppConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to load app config from ${filePath}: ${message}`);
  }

  const root = expectRecord(parsed, 'app config');
  const providers = parseAiProviders(root);

  return {
    defaults: parseDefaults(root),
    cache: parseCache(root),
    metadata: parseMetadata(root),
    ai: parseAiConfig(root, providers),
  };
}

function parseDefaults(root: Record<string, unknown>): AppConfig['defaults'] {
  const defaults = expectRecord(root.defaults, 'defaults');
  return {
    profileGroupName: expectNonEmptyString(defaults.profileGroupName, 'defaults.profileGroupName'),
    profileName: expectNonEmptyString(defaults.profileName, 'defaults.profileName'),
  };
}

function parseCache(root: Record<string, unknown>): AppConfig['cache'] {
  const cache = expectRecord(root.cache, 'cache');
  const tmdb = expectRecord(cache.tmdb, 'cache.tmdb');

  return {
    calendarTtlSeconds: expectPositiveNumber(cache.calendarTtlSeconds, 'cache.calendarTtlSeconds'),
    tmdb: {
      movieTtlHours: expectPositiveNumber(tmdb.movieTtlHours, 'cache.tmdb.movieTtlHours'),
      showTtlHours: expectPositiveNumber(tmdb.showTtlHours, 'cache.tmdb.showTtlHours'),
      seasonTtlHours: expectPositiveNumber(tmdb.seasonTtlHours, 'cache.tmdb.seasonTtlHours'),
    },
  };
}

function parseMetadata(root: Record<string, unknown>): AppConfig['metadata'] {
  const metadata = expectRecord(root.metadata, 'metadata');
  const tmdb = expectRecord(metadata.tmdb, 'metadata.tmdb');

  return {
    tmdb: {
      baseUrl: expectNonEmptyString(tmdb.baseUrl, 'metadata.tmdb.baseUrl'),
      imageBaseUrl: expectNonEmptyString(tmdb.imageBaseUrl, 'metadata.tmdb.imageBaseUrl'),
    },
  };
}

function parseAiProviders(root: Record<string, unknown>): Record<string, AppAiProviderConfig> {
  const ai = expectRecord(root.ai, 'ai');
  const providers = expectArray(ai.providers, 'ai.providers');
  const parsed: Record<string, AppAiProviderConfig> = {};

  for (const [index, value] of providers.entries()) {
    const provider = expectRecord(value, `ai.providers[${index}]`);
    const id = expectNonEmptyString(provider.id, `ai.providers[${index}].id`);
    if (Object.hasOwn(parsed, id)) {
      throw new Error(`Duplicate AI provider id in app config: ${id}`);
    }

    const models = expectRecord(provider.models, `ai.providers[${index}].models`);
    parsed[id] = {
      id,
      label: expectNonEmptyString(provider.label, `ai.providers[${index}].label`),
      endpointUrl: expectNonEmptyString(provider.endpointUrl, `ai.providers[${index}].endpointUrl`),
      models: {
        search: expectNonEmptyString(models.search, `ai.providers[${index}].models.search`),
        insights: expectNonEmptyString(models.insights, `ai.providers[${index}].models.insights`),
      },
    };
  }

  if (Object.keys(parsed).length === 0) {
    throw new Error('App config must define at least one AI provider.');
  }

  return parsed;
}

function parseAiConfig(
  root: Record<string, unknown>,
  providers: Record<string, AppAiProviderConfig>,
): AppConfig['ai'] {
  const ai = expectRecord(root.ai, 'ai');
  const defaultProviderId = expectNonEmptyString(ai.defaultProviderId, 'ai.defaultProviderId');
  if (!Object.hasOwn(providers, defaultProviderId)) {
    throw new Error(`ai.defaultProviderId must reference a configured provider: ${defaultProviderId}`);
  }

  const serverFallback = expectRecord(ai.serverFallback, 'ai.serverFallback');
  const features = expectRecord(ai.features, 'ai.features');

  return {
    defaultProviderId,
    providers,
    providerOrder: Object.keys(providers),
    features: {
      search: parseAiFeaturePolicy('search', features, providers),
      insights: parseAiFeaturePolicy('insights', features, providers),
    },
    serverFallback: {
      transientCooldownSeconds: expectPositiveNumberArray(
        serverFallback.transientCooldownSeconds,
        'ai.serverFallback.transientCooldownSeconds',
      ),
      rateLimitCooldownSeconds: expectPositiveNumberArray(
        serverFallback.rateLimitCooldownSeconds,
        'ai.serverFallback.rateLimitCooldownSeconds',
      ),
      providerBlockSeconds: expectPositiveNumber(serverFallback.providerBlockSeconds, 'ai.serverFallback.providerBlockSeconds'),
    },
  };
}

function parseAiFeaturePolicy(
  feature: AiFeatureId,
  features: Record<string, unknown>,
  providers: Record<string, AppAiProviderConfig>,
): AiFeaturePolicy {
  const entry = expectRecord(features[feature], `ai.features.${feature}`);
  const fallback = expectArray(entry.fallback, `ai.features.${feature}.fallback`);

  return {
    fallback: fallback.map((value, index) => parseAiFeaturePolicyStep(feature, value, index, providers)),
  };
}

function parseAiFeaturePolicyStep(
  feature: AiFeatureId,
  value: unknown,
  index: number,
  providers: Record<string, AppAiProviderConfig>,
): AiFeaturePolicyStep {
  const step = expectRecord(value, `ai.features.${feature}.fallback[${index}]`);
  const source = expectEnumValue(step.source, `ai.features.${feature}.fallback[${index}].source`, CREDENTIAL_SOURCES);
  const providerValue = expectNonEmptyString(step.provider, `ai.features.${feature}.fallback[${index}].provider`);
  const models = step.models === undefined
    ? undefined
    : expectNonEmptyStringArray(step.models, `ai.features.${feature}.fallback[${index}].models`);

  if (providerValue === 'account') {
    return { source, provider: { type: 'account' }, models };
  }

  if (!Object.hasOwn(providers, providerValue)) {
    throw new Error(`Unknown provider '${providerValue}' in ai.features.${feature}.fallback[${index}]`);
  }

  return {
    source,
    provider: { type: 'fixed', providerId: providerValue },
    models,
  };
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object.`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an array.`);
  }
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${label}: expected a string.`);
  }
  return value.trim();
}

function expectNonEmptyString(value: unknown, label: string): string {
  const normalized = expectString(value, label);
  if (!normalized) {
    throw new Error(`Invalid ${label}: expected a non-empty string.`);
  }
  return normalized;
}

function expectPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}: expected a positive number.`);
  }
  return value;
}

function expectPositiveNumberArray(value: unknown, label: string): number[] {
  const values = expectArray(value, label).map((entry, index) =>
    expectPositiveNumber(entry, `${label}[${index}]`),
  );

  if (values.length === 0) {
    throw new Error(`Invalid ${label}: expected at least one value.`);
  }

  return values;
}

function expectNonEmptyStringArray(value: unknown, label: string): string[] {
  const values = expectArray(value, label)
    .map((entry, index) => expectNonEmptyString(entry, `${label}[${index}]`));

  if (values.length === 0) {
    throw new Error(`Invalid ${label}: expected at least one value.`);
  }

  return [...new Set(values)];
}

function expectEnumValue<T extends string>(value: unknown, label: string, allowed: T[]): T {
  const normalized = expectNonEmptyString(value, label) as T;
  if (!allowed.includes(normalized)) {
    throw new Error(`Invalid ${label}: expected one of ${allowed.join(', ')}.`);
  }
  return normalized;
}
