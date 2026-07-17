import { env, VALID_IMPORT_CLIENT_IDS, type ImportClientId } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';

export const IMPORT_CLIENT_IDS = VALID_IMPORT_CLIENT_IDS;

export type ValidatedImportReturnTo = {
  clientId: ImportClientId;
  baseUrl: string;
};

/**
 * Validates a client-supplied return-to request for OAuth import flows.
 * Mirrors the pattern in app-login-handoff.service.ts:validateReturnUri but for
 * the import callback redirect.
 *
 * Inputs are the raw `clientId` (one of VALID_IMPORT_CLIENT_IDS) and `returnTo`
 * (base URL the client wants to be redirected back to after the provider
 * callback, e.g. "https://app.crispytv.tech" or "crispytv://auth/callback").
 *
 * For desktop clients, a loopback http://127.0.0.1:<port>/auth/callback is
 * accepted (matching the app-login handoff behaviour).
 */
export function validateImportReturnTo(clientId: string | undefined, returnTo: string | undefined): ValidatedImportReturnTo {
  const trimmedClient = (clientId ?? '').trim();
  if (!trimmedClient) {
    throw new HttpError(400, 'Client ID is required for provider import redirect.', undefined, 'invalid_client_id');
  }
  if (!IMPORT_CLIENT_IDS.includes(trimmedClient as ImportClientId)) {
    throw new HttpError(400, 'Unknown import client ID.', undefined, 'invalid_client_id');
  }
  const clientIdTyped = trimmedClient as ImportClientId;

  const trimmed = (returnTo ?? '').trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new HttpError(400, 'Invalid return URI for provider import.', undefined, 'invalid_return_uri');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, 'Return URI for provider import is not a valid URL.', undefined, 'invalid_return_uri');
  }

  if (!parsed.protocol || parsed.protocol === 'javascript:') {
    throw new HttpError(400, 'Invalid return URI protocol for provider import.', undefined, 'invalid_return_uri');
  }

  // Desktop loopback: allow http://127.0.0.1:<port>/auth/callback (any port)
  if (clientIdTyped === 'crispy-desktop') {
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === 'localhost') &&
      parsed.port &&
      parsed.pathname.replace(/\/+$/, '') === '/auth/callback'
    ) {
      return { clientId: clientIdTyped, baseUrl: parsed.toString().replace(/\/+$/, '') };
    }
    throw new HttpError(400, 'Desktop return URI must be a loopback /auth/callback address.', undefined, 'invalid_return_uri');
  }

  const allowed = env.importAllowedReturnUris.get(clientIdTyped);
  const normalizedBase = trimmed.replace(/\/+$/, '');
  if (!allowed || !allowed.has(normalizedBase)) {
    throw new HttpError(400, 'Return URI is not allowed for this import client.', undefined, 'return_uri_not_allowed');
  }

  return { clientId: clientIdTyped, baseUrl: normalizedBase };
}

/**
 * Builds the final browser redirect URL the server sends after the provider
 * OAuth callback finishes. The token exchange already happened server-side;
 * the client just needs status + provider + profile_id to re-fetch state.
 *
 * For http(s) bases the subject URL is "<base>/auth/connect/<provider>".
 * For custom-scheme bases (crispytv://, app://) the base itself is used as
 * authored by the operator in the allowlist (e.g. "crispytv://auth/connect"),
 * so the additional path is not synthesized.
 *
 * Query params (all URL-safe):
 *   - status:    "ok" | "error"
 *   - provider:  "trakt" | "simkl"
 *   - profileId: GUID
 *   - code:      short error code (only when status=error)
 */
export function buildImportReturnUrl(
  validated: ValidatedImportReturnTo,
  params: {
    provider: 'trakt' | 'simkl';
    status: 'ok' | 'error';
    profileId: string;
    errorCode?: string | null;
  },
): string {
  const base = validated.baseUrl.replace(/\/+$/, '');
  const isCustomScheme = !base.startsWith('http');
  // For custom-scheme (deep-link) bases the base itself is the entrypoint, so
  // we don't synthesize a path. For http(s) bases we land on the SPA route.
  const endpoint = isCustomScheme ? base : `${base}/auth/connect/${params.provider}`;

  const query = new URLSearchParams();
  query.set('status', params.status);
  query.set('provider', params.provider);
  query.set('profileId', params.profileId);
  if (params.status === 'error' && params.errorCode) {
    query.set('code', params.errorCode);
  }

  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}${query.toString()}`;
}
