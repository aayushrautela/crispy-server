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

function requireOneOfEnv(names: string[]): string {
  for (const name of names) {
    const value = optionalEnv(name);
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
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

export const env = {
  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  serverHost: process.env.SERVER_HOST?.trim() || '0.0.0.0',
  serverPort: parseNumber('SERVER_PORT', 18765),
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  databaseUrl: requireEnv('DATABASE_URL'),
  redisUrl: requireEnv('REDIS_URL'),
  authJwksUrl: requireOneOfEnv(['AUTH_JWKS_URL', 'SUPABASE_JWKS_URL']),
  authJwtIssuer: requireOneOfEnv(['AUTH_JWT_ISSUER', 'SUPABASE_JWT_ISSUER']),
  authJwtAudience: requireOneOfEnv(['AUTH_JWT_AUDIENCE', 'SUPABASE_JWT_AUDIENCE']),
  authAdminUrl: optionalEnv('AUTH_ADMIN_URL') ?? optionalEnv('SUPABASE_AUTH_ADMIN_URL') ?? '',
  authAdminToken: optionalEnv('AUTH_ADMIN_TOKEN') ?? optionalEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  defaultHouseholdName: process.env.DEFAULT_HOUSEHOLD_NAME?.trim() || 'Crispy Household',
  defaultProfileName: process.env.DEFAULT_PROFILE_NAME?.trim() || 'Main',
  homeCacheTtlSeconds: parseNumber('HOME_CACHE_TTL_SECONDS', 120),
  calendarCacheTtlSeconds: parseNumber('CALENDAR_CACHE_TTL_SECONDS', 300),
  tmdbApiKey: requireEnv('TMDB_API_KEY'),
  tmdbBaseUrl: process.env.TMDB_BASE_URL?.trim() || 'https://api.themoviedb.org/3',
  tmdbImageBaseUrl: process.env.TMDB_IMAGE_BASE_URL?.trim() || 'https://image.tmdb.org/t/p',
  tmdbMovieTtlHours: parseNumber('TMDB_MOVIE_TTL_HOURS', 168),
  tmdbShowTtlHours: parseNumber('TMDB_SHOW_TTL_HOURS', 24),
  tmdbSeasonTtlHours: parseNumber('TMDB_SEASON_TTL_HOURS', 24),
  aiSearchOpenrouterModel: process.env.AI_SEARCH_OPENROUTER_MODEL?.trim() || 'arcee-ai/trinity-large-preview:free',
  aiInsightsOpenrouterModel: process.env.AI_INSIGHTS_OPENROUTER_MODEL?.trim() || '',
  openrouterHttpReferer: process.env.OPENROUTER_HTTP_REFERER?.trim() || 'https://crispy-app.com',
  openrouterTitle: process.env.OPENROUTER_TITLE?.trim() || 'Crispy Rewrite',
  traktImportClientId: process.env.TRAKT_IMPORT_CLIENT_ID?.trim() || '',
  traktImportClientSecret: process.env.TRAKT_IMPORT_CLIENT_SECRET?.trim() || '',
  traktImportRedirectUri: process.env.TRAKT_IMPORT_REDIRECT_URI?.trim() || '',
  simklImportClientId: process.env.SIMKL_IMPORT_CLIENT_ID?.trim() || '',
  simklImportClientSecret: process.env.SIMKL_IMPORT_CLIENT_SECRET?.trim() || '',
  simklImportRedirectUri: process.env.SIMKL_IMPORT_REDIRECT_URI?.trim() || '',
  recommendationApiKey: process.env.RECOMMENDATION_API_KEY?.trim() || '',
};

export type Env = typeof env;
