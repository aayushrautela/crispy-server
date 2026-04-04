export type AuthActorType = 'user' | 'pat' | 'service';

export const AUTH_SCOPES = [
  'profiles:read',
  'watch:read',
  'taste-profile:read',
  'taste-profile:write',
  'recommendations:read',
  'recommendations:write',
  'profile-secrets:read',
  'provider-connections:read',
  'provider-tokens:read',
  'provider-tokens:refresh',
  'admin:diagnostics:read',
] as const;

export type AuthScope = (typeof AUTH_SCOPES)[number];

export type AuthActor = {
  type: AuthActorType;
  appUserId: string | null;
  serviceId: string | null;
  scopes: AuthScope[];
  authSubject: string | null;
  email: string | null;
  tokenId: string | null;
  consumerId: string | null;
};

export type UserAuthActor = AuthActor & {
  type: 'user' | 'pat';
  appUserId: string;
};

export const USER_DEFAULT_SCOPES: AuthScope[] = [
  'profiles:read',
  'watch:read',
  'taste-profile:read',
  'taste-profile:write',
  'recommendations:read',
  'recommendations:write',
];

export const PAT_DEFAULT_SCOPES: AuthScope[] = [
  'profiles:read',
  'watch:read',
  'taste-profile:read',
  'recommendations:read',
];

export const PAT_ALLOWED_SCOPES: AuthScope[] = [
  'profiles:read',
  'watch:read',
  'taste-profile:read',
  'taste-profile:write',
  'recommendations:read',
  'recommendations:write',
];

export function isAuthScope(value: unknown): value is AuthScope {
  return typeof value === 'string' && AUTH_SCOPES.includes(value as AuthScope);
}

export function isPersonalAccessTokenScope(value: unknown): value is AuthScope {
  return typeof value === 'string' && PAT_ALLOWED_SCOPES.includes(value as AuthScope);
}
