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

// OAuth import callback return-to allowlist.
// Format (same as APP_LOGIN_ALLOWED_RETURN_URIS): "clientId:https://app.crispytv.tech,crispy-android:crispytv://auth/callback,..."
// The clientId here is a coarse platform tag (e.g. "crispy-web", "crispy-android", "crispy-desktop")
// and the URI is the base the server appends "/auth/connect/<provider>" + query to.
export const VALID_IMPORT_CLIENT_IDS = ['crispy-web', 'crispy-ios', 'crispy-android', 'crispy-desktop'] as const;
export type ImportClientId = typeof VALID_IMPORT_CLIENT_IDS[number];

export function parseImportAllowedReturnUris(name: string): Map<ImportClientId, Set<string>> {
  const raw = process.env[name];
  if (!raw) return new Map();
  const map = new Map<ImportClientId, Set<string>>();
  for (const entry of raw.split(',').map(e => e.trim()).filter(Boolean)) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx <= 0) throw new Error(`Invalid ${name} entry: ${entry}`);
    const clientId = entry.slice(0, colonIdx) as ImportClientId;
    const uri = entry.slice(colonIdx + 1);
    if (!clientId || !uri) throw new Error(`Invalid ${name} entry: ${entry}`);
    if (!VALID_IMPORT_CLIENT_IDS.includes(clientId)) throw new Error(`Unknown import client id in ${name}: ${clientId}`);
    try {
      const parsed = new URL(uri);
      if (parsed.protocol === 'javascript:') throw new Error(`Invalid protocol in ${name}: ${uri}`);
    } catch {
      throw new Error(`Invalid URL in ${name}: ${uri}`);
    }
    // Allow custom-scheme URIs (e.g. crispytv://) — URL parsing still works, protocol is "crispytv:".
    const set = map.get(clientId) ?? new Set();
    set.add(uri.replace(/\/+$/, ''));
    map.set(clientId, set);
  }
  return map;
}

const authBaseUrl = requireBaseUrl('AUTH_BASE_URL');
const authAuthBaseUrl = `${authBaseUrl}/auth/v1`;
const authAdminApiKey = requireEnv('AUTH_ADMIN_API_KEY');
const authJwtIssuer = optionalBaseUrl('AUTH_JWT_ISSUER') ?? authAuthBaseUrl;

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
  importAllowedReturnUris: parseImportAllowedReturnUris('IMPORT_OAUTH_ALLOWED_RETURN_URIS'),
  databaseUrl: requireEnv('DATABASE_URL'),
  databasePoolMax: parseNumber('DATABASE_POOL_MAX', 20),
  redisUrl: requireEnv('REDIS_URL'),
  appPublicUrl: requireBaseUrl('APP_PUBLIC_URL'),
  appDisplayName: requireEnv('APP_DISPLAY_NAME'),
  authBaseUrl,
  authAdminApiKey,
  authJwksUrl: requireBaseUrl('AUTH_JWKS_URL'),
  authJwtIssuer,
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
  continueWatchingTtlDays: parseNumber('CONTINUE_WATCHING_TTL_DAYS', 365),
  homescreenDefaultTtlSeconds: parseNumber('HOMESCREEN_DEFAULT_TTL_SECONDS', 21600),
  homescreenDefaultRebuildCron: optionalEnv('HOMESCREEN_DEFAULT_REBUILD_CRON') ?? '0 */6 * * *',
  homescreenTraktSyncCron: optionalEnv('HOMESCREEN_TRAKT_SYNC_CRON') ?? '0 3 * * *',
  recommenderToMainServiceTokenHash: optionalEnv('RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH') ?? '',
  recommenderInternalBaseUrl: optionalBaseUrl('RECOMMENDER_INTERNAL_BASE_URL') ?? '',
  mainToRecommenderServiceToken: optionalEnv('MAIN_TO_RECOMMENDER_SERVICE_TOKEN') ?? '',
  recommenderNotifyTimeoutMs: parseNumber('RECOMMENDER_NOTIFY_TIMEOUT_MS', 5000),
};

export type Env = typeof env;
