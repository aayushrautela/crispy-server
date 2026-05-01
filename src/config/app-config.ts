import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AiFeatureId, AiProviderView, ServerAiTier } from '../modules/ai/ai.types.js';

export const BYOK_OPENROUTER_PROVIDER_ID = 'openrouter';
export const BYOK_OPENROUTER_LABEL = 'OpenRouter';
export const BYOK_OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export type AppAiProviderConfig = {
  id: string;
  label: string;
  endpointUrl: string;
  models: Record<AiFeatureId, string>;
};

export type AppServerAiConfig = {
  id: string;
  label: string;
  endpointUrl: string;
  models: Record<ServerAiTier, Record<AiFeatureId, string>>;
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
    byokOpenRouter: AppAiProviderConfig;
    server: AppServerAiConfig;
  };
};

export const appConfigPath = resolveAppConfigPath();
export const appConfig = loadAppConfig(appConfigPath);

export function getByokOpenRouterProvider(): AppAiProviderConfig {
  return appConfig.ai.byokOpenRouter;
}

export function getServerAiProvider(): AppServerAiConfig {
  return appConfig.ai.server;
}

export function listPublicAiProviders(): AiProviderView[] {
  const provider = getByokOpenRouterProvider();
  return [{
    id: provider.id,
    label: provider.label,
    models: provider.models,
  }];
}

export function normalizeAiProviderId(_value: string | null | undefined): string {
  return BYOK_OPENROUTER_PROVIDER_ID;
}

export function isAiProviderId(value: string): boolean {
  return value.trim() === BYOK_OPENROUTER_PROVIDER_ID;
}

export function requireAiProvider(_providerId: string): AppAiProviderConfig {
  return getByokOpenRouterProvider();
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

  return {
    defaults: parseDefaults(root),
    cache: parseCache(root),
    metadata: parseMetadata(root),
    ai: parseAiConfig(root),
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

function parseAiConfig(root: Record<string, unknown>): AppConfig['ai'] {
  const ai = expectRecord(root.ai, 'ai');
  const legacyProviders = parseLegacyAiProviders(ai);
  const legacyOpenRouter = legacyProviders[BYOK_OPENROUTER_PROVIDER_ID] ?? Object.values(legacyProviders)[0];

  return {
    byokOpenRouter: parseByokOpenRouter(ai, legacyOpenRouter),
    server: parseServerAi(ai, legacyOpenRouter),
  };
}

function parseByokOpenRouter(ai: Record<string, unknown>, legacyProvider?: AppAiProviderConfig): AppAiProviderConfig {
  const configured = isRecord(ai.byokOpenRouter) ? ai.byokOpenRouter : null;
  const modelsSource = configured && Object.hasOwn(configured, 'models')
    ? expectRecord(configured.models, 'ai.byokOpenRouter.models')
    : legacyProvider?.models;

  return {
    id: BYOK_OPENROUTER_PROVIDER_ID,
    label: BYOK_OPENROUTER_LABEL,
    endpointUrl: BYOK_OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
    models: parseFeatureModels(modelsSource, 'ai.byokOpenRouter.models'),
  };
}

function parseServerAi(ai: Record<string, unknown>, legacyProvider?: AppAiProviderConfig): AppServerAiConfig {
  const server = isRecord(ai.server) ? ai.server : null;
  if (!server && legacyProvider) {
    return {
      id: legacyProvider.id,
      label: legacyProvider.label,
      endpointUrl: legacyProvider.endpointUrl,
      models: {
        pro: legacyProvider.models,
        ultra: legacyProvider.models,
      },
    };
  }

  if (!server) {
    throw new Error('App config must define ai.server.');
  }

  const modelTiers = expectRecord(server.models, 'ai.server.models');
  return {
    id: optionalNonEmptyString(server.id, 'ai.server.id') ?? 'server-ai',
    label: optionalNonEmptyString(server.label, 'ai.server.label') ?? 'Server AI',
    endpointUrl: expectNonEmptyString(server.endpointUrl, 'ai.server.endpointUrl'),
    models: {
      pro: parseFeatureModels(modelTiers.pro, 'ai.server.models.pro'),
      ultra: parseFeatureModels(modelTiers.ultra, 'ai.server.models.ultra'),
    },
  };
}

function parseLegacyAiProviders(ai: Record<string, unknown>): Record<string, AppAiProviderConfig> {
  if (!Array.isArray(ai.providers)) {
    return {};
  }

  const parsed: Record<string, AppAiProviderConfig> = {};
  for (const [index, value] of ai.providers.entries()) {
    const provider = expectRecord(value, `ai.providers[${index}]`);
    const id = expectNonEmptyString(provider.id, `ai.providers[${index}].id`);
    parsed[id] = {
      id,
      label: expectNonEmptyString(provider.label, `ai.providers[${index}].label`),
      endpointUrl: expectNonEmptyString(provider.endpointUrl, `ai.providers[${index}].endpointUrl`),
      models: parseFeatureModels(provider.models, `ai.providers[${index}].models`),
    };
  }
  return parsed;
}

function parseFeatureModels(value: unknown, label: string): Record<AiFeatureId, string> {
  const models = expectRecord(value, label);
  return {
    recommendations: expectNonEmptyString(models.recommendations, `${label}.recommendations`),
    search: expectNonEmptyString(models.search, `${label}.search`),
    insights: expectNonEmptyString(models.insights, `${label}.insights`),
  };
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return expectNonEmptyString(value, label);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}: expected an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
