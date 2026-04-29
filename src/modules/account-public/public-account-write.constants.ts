export const PUBLIC_ACCOUNT_WRITE_SOURCE = 'account_api' as const;
export const PUBLIC_RECOMMENDATION_LIST_KEY_PATTERN = /^external:[a-z0-9][a-z0-9._-]{0,63}$/;
export const PUBLIC_RECOMMENDATION_PROTECTED_LIST_KEY_PREFIXES = [
  'reco:',
  'crispy:',
  'internal:',
  'system:',
  'generated:',
  'service:',
] as const;
export const PUBLIC_ACCOUNT_WRITE_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_ACCOUNT_WRITE_MAX_IDEMPOTENCY_KEY_LENGTH = 128;
