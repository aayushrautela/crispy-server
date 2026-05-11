import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let serviceRoleClient: SupabaseClient | null = null;

export function getSupabaseServiceRoleClient(): SupabaseClient {
  const key = env.supabaseAdminApiKey;
  if (!key) {
    throw new Error('Missing required environment variable: SUPABASE_SECRET_KEY');
  }

  serviceRoleClient ??= createClient(env.supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return serviceRoleClient;
}

export function createSupabaseUserClient(accessToken: string): SupabaseClient {
  if (!accessToken.trim()) {
    throw new Error('Supabase user access token is required.');
  }

  if (!env.supabasePublishableKey) {
    throw new Error('Missing required environment variable: SUPABASE_PUBLISHABLE_KEY');
  }

  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
