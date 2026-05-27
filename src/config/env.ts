import dotenv from 'dotenv';
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

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }

  throw new Error(`Invalid boolean environment variable: ${name}`);
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

const adminBulkJobWorkerModes = ['off', 'standalone', 'inline'] as const;

function requireBaseUrl(name: string): string {
  return requireEnv(name).replace(/\/+$/, '');
}

function optionalBaseUrl(name: string): string | undefined {
  const value = optionalEnv(name);
  return value ? value.replace(/\/+$/, '') : undefined;
}

function parseAppLoginAllowedReturnUris(name: string): Map<string, Set<string>> {
  const raw = process.env[name];
  if (!raw) return new Map();
  const map = new Map<string, Set<string>>();
  for (const entry of raw.split(',').map(e => e.trim()).filter(Boolean)) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx <= 0) throw new Error(`Invalid ${name} entry: ${entry}`);
    const clientId = entry.slice(0, colonIdx);
    const uri = entry.slice(colonIdx + 1);
    if (!clientId || !uri) throw new Error(`Invalid ${name} entry: ${entry}`);
    try { new URL(uri); } catch { throw new Error(`Invalid URL in ${name}: ${uri}`); }
    const set = map.get(clientId) ?? new Set();
    set.add(uri);
    map.set(clientId, set);
  }
  return map;
}

const authBaseUrl = requireBaseUrl('AUTH_BASE_URL');
const authAuthBaseUrl = `${authBaseUrl}/auth/v1`;
const authAdminApiKey = requireEnv('AUTH_ADMIN_API_KEY');

export const env = {
  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  serverHost: process.env.SERVER_HOST?.trim() || '0.0.0.0',
  serverPort: parseNumber('SERVER_PORT', 18765),
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  corsOrigins: parseStringListEnv('CORS_ORIGINS'),
  adminUiUser: optionalEnv('ADMIN_UI_USER') ?? '',
  adminUiPassword: optionalEnv('ADMIN_UI_PASSWORD') ?? '',
  adminUiSessionSecret: optionalEnv('ADMIN_UI_SESSION_SECRET') ?? '',
  cursorSigningSecret: requireEnv('CURSOR_SIGNING_SECRET'),
  appLoginAllowedReturnUris: parseAppLoginAllowedReturnUris('APP_LOGIN_ALLOWED_RETURN_URIS'),
  databaseUrl: requireEnv('DATABASE_URL'),
  databasePoolMax: parseNumber('DATABASE_POOL_MAX', 20),
  redisUrl: requireEnv('REDIS_URL'),
  appPublicUrl: requireBaseUrl('APP_PUBLIC_URL'),
  appDisplayName: requireEnv('APP_DISPLAY_NAME'),
  accountPortalUrl: requireBaseUrl('ACCOUNT_PORTAL_URL'),
  authBaseUrl,
  authAdminApiKey,
  authJwksUrl: `${authAuthBaseUrl}/.well-known/jwks.json`,
  authJwtIssuer: authAuthBaseUrl,
  authJwtAudience: requireEnv('AUTH_JWT_AUDIENCE'),
  authAdminUrl: authAuthBaseUrl,
  tmdbApiKey: requireEnv('TMDB_API_KEY'),
  mdblistApiKey: optionalEnv('MDBLIST_API_KEY') ?? '',
  aiServerApiKey: optionalEnv('AI_SERVER_API_KEY') ?? '',
  secretsEncryptionKey: requireEnv('SECRETS_ENCRYPTION_KEY'),
  traktImportClientId: process.env.TRAKT_IMPORT_CLIENT_ID?.trim() || '',
  traktImportClientSecret: process.env.TRAKT_IMPORT_CLIENT_SECRET?.trim() || '',
  traktImportRedirectUri: process.env.TRAKT_IMPORT_REDIRECT_URI?.trim() || '',
  simklImportClientId: process.env.SIMKL_IMPORT_CLIENT_ID?.trim() || '',
  simklImportClientSecret: process.env.SIMKL_IMPORT_CLIENT_SECRET?.trim() || '',
  simklImportRedirectUri: process.env.SIMKL_IMPORT_REDIRECT_URI?.trim() || '',
  recommendationAlgorithmVersion: optionalEnv('RECOMMENDATION_ALGORITHM_VERSION') ?? 'v3.2.1',
  recommendationGenerationTtlSeconds: parseNumber('RECOMMENDATION_GENERATION_TTL_SECONDS', 86400),
  recommenderToMainServiceTokenHash: optionalEnv('RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH') ?? '',
  recommenderInternalBaseUrl: optionalBaseUrl('RECOMMENDER_INTERNAL_BASE_URL') ?? '',
  mainToRecommenderServiceToken: optionalEnv('MAIN_TO_RECOMMENDER_SERVICE_TOKEN') ?? '',
  adminRecommendationRecomputeJobsEnabled: parseBoolean('ADMIN_RECOMMENDATION_RECOMPUTE_JOBS_ENABLED', false),
  adminRecommendationRecomputeJobsCreateEnabled: parseBoolean('ADMIN_RECOMMENDATION_RECOMPUTE_JOBS_CREATE_ENABLED', false),
  adminBulkJobsWorkerMode: parseStringEnumEnv('ADMIN_BULK_JOBS_WORKER_MODE', adminBulkJobWorkerModes, 'off'),
  adminBulkJobsPollIntervalMs: parseNumber('ADMIN_BULK_JOBS_POLL_INTERVAL_MS', 5000),
  adminBulkJobsPollJitterMs: parseNumber('ADMIN_BULK_JOBS_POLL_JITTER_MS', 1000),
  adminBulkJobsClaimTtlMs: parseNumber('ADMIN_BULK_JOBS_CLAIM_TTL_MS', 300000),
  adminBulkJobsShutdownTimeoutMs: parseNumber('ADMIN_BULK_JOBS_SHUTDOWN_TIMEOUT_MS', 30000),
  adminBulkJobsMaxConcurrentJobs: parseNumber('ADMIN_BULK_JOBS_MAX_CONCURRENT_JOBS', 1),
  adminBulkJobsEnumerationPageSize: parseNumber('ADMIN_BULK_JOBS_ENUMERATION_PAGE_SIZE', 500),
  adminBulkJobsFanoutBatchSize: parseNumber('ADMIN_BULK_JOBS_FANOUT_BATCH_SIZE', 100),
  outboxDispatcherEnabled: parseBoolean('OUTBOX_DISPATCHER_ENABLED', false),
  outboxDispatchBatchSize: parseNumber('OUTBOX_DISPATCH_BATCH_SIZE', 10),
  outboxDispatchIntervalMs: parseNumber('OUTBOX_DISPATCH_INTERVAL_MS', 5000),
  outboxDispatchLockSeconds: parseNumber('OUTBOX_DISPATCH_LOCK_SECONDS', 60),
  outboxDispatchMaxAttempts: parseNumber('OUTBOX_DISPATCH_MAX_ATTEMPTS', 10),
  outboxDispatchRetryBaseMs: parseNumber('OUTBOX_DISPATCH_RETRY_BASE_MS', 1000),
  outboxDispatchRetryMaxMs: parseNumber('OUTBOX_DISPATCH_RETRY_MAX_MS', 300000),
};

export type Env = typeof env;
