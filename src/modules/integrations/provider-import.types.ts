export type ProviderImportProvider = 'trakt' | 'simkl';

export type ProviderAccountStatus = 'pending' | 'connected' | 'expired' | 'revoked';

export type ProviderImportJobMode = 'replace_import';

export type ProviderImportJobStatus =
  | 'oauth_pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'succeeded_with_warnings'
  | 'failed'
  | 'cancelled';

export type ProfileWatchDataOrigin = 'native' | 'provider_import';

export function isProviderImportProvider(value: unknown): value is ProviderImportProvider {
  return value === 'trakt' || value === 'simkl';
}
