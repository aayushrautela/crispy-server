export type ProviderImportProvider = 'trakt' | 'simkl';

export type ProviderImportJobMode = 'replace_import';

export type ProviderImportJobStatus =
  | 'oauth_pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'succeeded_with_warnings'
  | 'failed'
  | 'cancelled';

export const PROVIDER_IMPORT_PROVIDERS: readonly ProviderImportProvider[] = ['trakt', 'simkl'] as const;

export function isProviderImportProvider(value: unknown): value is ProviderImportProvider {
  return typeof value === 'string' && (PROVIDER_IMPORT_PROVIDERS as readonly string[]).includes(value);
}

export function providerLabel(provider: ProviderImportProvider): string {
  return provider === 'trakt' ? 'Trakt' : 'Simkl';
}
