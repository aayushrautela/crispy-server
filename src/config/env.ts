import dotenv from 'dotenv';
import { parseServiceClientRegistryConfig } from '../modules/auth/service-client-registry.js';

dotenv.config();

function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function parseStringListEnv(name: string): string[] {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }
  return parsed;
}

function parseStringEnumEnv<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  if ((allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }

  throw new Error(`Invalid value for ${name}: ${raw}`);
}

function parseAiServerKeysEnv(name: string): Array<{ providerId: string; apiKey: string }> {
  const raw = optionalEnv(name);
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON environment variable: ${name}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid AI server key configuration: ${name}`);
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid AI server key entry at index ${index} in ${name}`);
    }

    const record = entry as Record<string, unknown>;
    const providerId = typeof record.providerId === 'string'
      ? record.providerId.trim()
      : '';
    const apiKey = typeof record.apiKey === 'string'
      ? record.apiKey.trim()
      : '';

    if (!providerId || !apiKey) {
      throw new Error(`Invalid AI server key entry at index ${index} in ${name}`);
    }

    return { providerId, apiKey };
  });
}

function requireBaseUrl(name: string): string {
  return requireEnv(name).replace(/\/+$/, '');
}

function optionalBaseUrl(name: string): string | undefined {
  const value = optionalEnv(name);
  return value ? value.replace(/\/+$/, '') : undefined;
}

const supabaseUrl = requireBaseUrl('SUPABASE_URL');
const supabaseAuthBaseUrl = `${supabaseUrl}/auth/v1`;

export const env = {
  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  serverHost: process.env.SERVER_HOST?.trim() || '0.0.0.0',
  serverPort: parseNumber('SERVER_PORT', 18765),
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  adminUiUser: optionalEnv('ADMIN_UI_USER') ?? '',
  adminUiPassword: optionalEnv('ADMIN_UI_PASSWORD') ?? '',
  adminUiSessionSecret: optionalEnv('ADMIN_UI_SESSION_SECRET') ?? '',
  databaseUrl: requireEnv('DATABASE_URL'),
  redisUrl: requireEnv('REDIS_URL'),
  supabaseUrl,
  supabaseSecretKey: optionalEnv('SUPABASE_SECRET_KEY') ?? '',
  authJwksUrl: `${supabaseAuthBaseUrl}/.well-known/jwks.json`,
  authJwtIssuer: supabaseAuthBaseUrl,
  authJwtAudience: requireEnv('AUTH_JWT_AUDIENCE'),
  authAdminUrl: supabaseAuthBaseUrl,
  tmdbApiKey: requireEnv('TMDB_API_KEY'),
  tvdbApiKey: requireEnv('TVDB_API_KEY'),
  tvdbPin: optionalEnv('TVDB_PIN') ?? '',
  mdblistApiKey: optionalEnv('MDBLIST_API_KEY') ?? '',
  aiServerKeys: parseAiServerKeysEnv('AI_SERVER_KEYS_JSON'),
  traktImportClientId: process.env.TRAKT_IMPORT_CLIENT_ID?.trim() || '',
  traktImportClientSecret: process.env.TRAKT_IMPORT_CLIENT_SECRET?.trim() || '',
  traktImportRedirectUri: process.env.TRAKT_IMPORT_REDIRECT_URI?.trim() || '',
  simklImportClientId: process.env.SIMKL_IMPORT_CLIENT_ID?.trim() || '',
  simklImportClientSecret: process.env.SIMKL_IMPORT_CLIENT_SECRET?.trim() || '',
  simklImportRedirectUri: process.env.SIMKL_IMPORT_REDIRECT_URI?.trim() || '',
  recommendationEngineWorkerBaseUrl: optionalEnv('RECOMMENDATION_ENGINE_WORKER_BASE_URL') ?? '',
  recommendationEngineWorkerApiKey: optionalEnv('RECOMMENDATION_ENGINE_WORKER_API_KEY') ?? '',
  recommendationEngineWorkerServiceId: optionalEnv('RECOMMENDATION_ENGINE_WORKER_SERVICE_ID') ?? '',
  recommendationWorkerMode: parseStringEnumEnv('RECOMMENDATION_WORKER_MODE', ['sync', 'async'] as const, 'sync'),
  recommendationAlgorithmVersion: optionalEnv('RECOMMENDATION_ALGORITHM_VERSION') ?? 'v3.2.1',
  recommendationGenerationTtlSeconds: parseNumber('RECOMMENDATION_GENERATION_TTL_SECONDS', 86400),
  recommendationGenerationQueueDelayMs: parseNumber('RECOMMENDATION_GENERATION_QUEUE_DELAY_MS', 5000),
  recommendationEngineWorkerTimeoutMs: parseNumber('RECOMMENDATION_ENGINE_WORKER_TIMEOUT_MS', 120000),
  recommendationEngineWorkerSubmitTimeoutMs: parseNumber('RECOMMENDATION_ENGINE_WORKER_SUBMIT_TIMEOUT_MS', 15000),
  recommendationEngineWorkerStatusTimeoutMs: parseNumber('RECOMMENDATION_ENGINE_WORKER_STATUS_TIMEOUT_MS', 15000),
  recommendationGenerationPollDelayMs: parseNumber('RECOMMENDATION_GENERATION_POLL_DELAY_MS', 15000),
  recommendationGenerationMaxPollDelayMs: parseNumber('RECOMMENDATION_GENERATION_MAX_POLL_DELAY_MS', 120000),
  serviceClients: parseServiceClientRegistryConfig(requireEnv('SERVICE_CLIENTS_JSON')),
};

export type Env = typeof env;
