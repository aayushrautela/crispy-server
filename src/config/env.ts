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
  appPublicUrl: requireBaseUrl('APP_PUBLIC_URL'),
  appDisplayName: requireEnv('APP_DISPLAY_NAME'),
  supabaseUrl,
  supabaseSecretKey: optionalEnv('SUPABASE_SECRET_KEY') ?? '',
  authJwksUrl: `${supabaseAuthBaseUrl}/.well-known/jwks.json`,
  authJwtIssuer: supabaseAuthBaseUrl,
  authJwtAudience: requireEnv('AUTH_JWT_AUDIENCE'),
  authAdminUrl: supabaseAuthBaseUrl,
  tmdbApiKey: requireEnv('TMDB_API_KEY'),
  mdblistApiKey: optionalEnv('MDBLIST_API_KEY') ?? '',
  aiServerApiKey: optionalEnv('AI_SERVER_API_KEY') ?? '',
  traktImportClientId: process.env.TRAKT_IMPORT_CLIENT_ID?.trim() || '',
  traktImportClientSecret: process.env.TRAKT_IMPORT_CLIENT_SECRET?.trim() || '',
  traktImportRedirectUri: process.env.TRAKT_IMPORT_REDIRECT_URI?.trim() || '',
  simklImportClientId: process.env.SIMKL_IMPORT_CLIENT_ID?.trim() || '',
  simklImportClientSecret: process.env.SIMKL_IMPORT_CLIENT_SECRET?.trim() || '',
  simklImportRedirectUri: process.env.SIMKL_IMPORT_REDIRECT_URI?.trim() || '',
  recommendationAlgorithmVersion: optionalEnv('RECOMMENDATION_ALGORITHM_VERSION') ?? 'v3.2.1',
  recommendationGenerationTtlSeconds: parseNumber('RECOMMENDATION_GENERATION_TTL_SECONDS', 86400),
  crispyRecommenderApiTokenHash: optionalEnv('CRISPY_RECOMMENDER_API_TOKEN_HASH') ?? '',
};

export type Env = typeof env;
