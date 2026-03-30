export type ProviderImportProvider = 'trakt' | 'simkl';

export type ProviderImportConnectionStatus = 'pending' | 'connected' | 'expired' | 'revoked';

export type ProviderImportJobMode = 'replace_import';

export type ProviderImportJobStatus =
  | 'oauth_pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'succeeded_with_warnings'
  | 'failed'
  | 'cancelled';

export type ProfileWatchDataOrigin = 'native' | 'trakt_import' | 'simkl_import';

export function isProviderImportProvider(value: unknown): value is ProviderImportProvider {
  return value === 'trakt' || value === 'simkl';
}
