import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AiFeatureId, ServerAiTier } from '../modules/ai/ai.types.js';

const DEFAULT_HOME_FRESH_SECONDS = 60;
const DEFAULT_HOME_STALE_SECONDS = 300;

export type AppServerAiConfig = {
  id: string;
  label: string;
  endpointUrl: string;
  models: Record<ServerAiTier, Record<AiFeatureId, string>>;
};

type AppConfig = {
  cache: {
    calendarTtlSeconds: number;
    home: {
      freshSeconds: number;
      staleSeconds: number;
    };
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
    server: AppServerAiConfig;
  };
};

export const appConfigPath = resolveAppConfigPath();
export const appConfig = loadAppConfig(appConfigPath);

export function getServerAiProvider(): AppServerAiConfig {
  return appConfig.ai.server;
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
    cache: parseCache(root),
    metadata: parseMetadata(root),
    ai: parseAiConfig(root),
  };
}

function parseCache(root: Record<string, unknown>): AppConfig['cache'] {
  const cache = expectRecord(root.cache, 'cache');
  const tmdb = expectRecord(cache.tmdb, 'cache.tmdb');

  return {
    calendarTtlSeconds: expectPositiveNumber(cache.calendarTtlSeconds, 'cache.calendarTtlSeconds'),
    home: parseHomeCache(cache),
    tmdb: {
      movieTtlHours: expectPositiveNumber(tmdb.movieTtlHours, 'cache.tmdb.movieTtlHours'),
      showTtlHours: expectPositiveNumber(tmdb.showTtlHours, 'cache.tmdb.showTtlHours'),
      seasonTtlHours: expectPositiveNumber(tmdb.seasonTtlHours, 'cache.tmdb.seasonTtlHours'),
    },
  };
}

/**
 * `cache.home` is optional so deployments that predate stale-while-revalidate
 * (or the example-only config) keep booting with sensible defaults instead of
 * the parser throwing on a missing block. Each sub-field also defaults
 * independently so a partially-specified `home` object does not crash.
 */
function parseHomeCache(cache: Record<string, unknown>): { freshSeconds: number; staleSeconds: number } {
  const home = isRecord(cache.home) ? (cache.home as Record<string, unknown>) : null;
  return {
    freshSeconds: home ? expectPositiveNumber(home.freshSeconds, 'cache.home.freshSeconds', DEFAULT_HOME_FRESH_SECONDS) : DEFAULT_HOME_FRESH_SECONDS,
    staleSeconds: home ? expectPositiveNumber(home.staleSeconds, 'cache.home.staleSeconds', DEFAULT_HOME_STALE_SECONDS) : DEFAULT_HOME_STALE_SECONDS,
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

  return {
    server: parseServerAi(ai),
  };
}

function parseServerAi(ai: Record<string, unknown>): AppServerAiConfig {
  const server = expectRecord(ai.server, 'ai.server');

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

function parseFeatureModels(value: unknown, label: string): Record<AiFeatureId, string> {
  const models = expectRecord(value, label);
  return {
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

function expectPositiveNumber(value: unknown, label: string, fallback?: number): number {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Invalid ${label}: expected a positive number.`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}: expected a positive number.`);
  }
  return value;
}
