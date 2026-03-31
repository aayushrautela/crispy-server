export function deriveWatchOrigins(payload: Record<string, unknown> | undefined): string[] {
  const provider = typeof payload?.provider === 'string' && payload.provider.trim() ? payload.provider.trim() : null;
  if (provider === 'trakt') {
    return ['trakt_import'];
  }
  if (provider === 'simkl') {
    return ['simkl_import'];
  }
  return ['native'];
}
