import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseJwksUrl: requireEnv('SUPABASE_JWKS_URL'),
  supabaseJwtIssuer: requireEnv('SUPABASE_JWT_ISSUER'),
  supabaseJwtAudience: requireEnv('SUPABASE_JWT_AUDIENCE'),
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
  traktImportClientId: process.env.TRAKT_IMPORT_CLIENT_ID?.trim() || '',
  traktImportClientSecret: process.env.TRAKT_IMPORT_CLIENT_SECRET?.trim() || '',
  traktImportRedirectUri: process.env.TRAKT_IMPORT_REDIRECT_URI?.trim() || '',
  simklImportClientId: process.env.SIMKL_IMPORT_CLIENT_ID?.trim() || '',
  simklImportClientSecret: process.env.SIMKL_IMPORT_CLIENT_SECRET?.trim() || '',
  simklImportRedirectUri: process.env.SIMKL_IMPORT_REDIRECT_URI?.trim() || '',
};

export type Env = typeof env;
