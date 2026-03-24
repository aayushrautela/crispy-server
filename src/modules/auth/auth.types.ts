export type AuthActorType = 'user' | 'pat' | 'service';

export type AuthScope =
  | 'profiles:read'
  | 'watch:read'
  | 'taste-profile:read'
  | 'taste-profile:write'
  | 'recommendations:read'
  | 'recommendations:write'
  | 'recommendation-work:claim'
  | 'recommendation-work:renew'
  | 'recommendation-work:complete';

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

export const SERVICE_DEFAULT_SCOPES: AuthScope[] = [
  'profiles:read',
  'watch:read',
  'taste-profile:read',
  'taste-profile:write',
  'recommendations:read',
  'recommendations:write',
  'recommendation-work:claim',
  'recommendation-work:renew',
  'recommendation-work:complete',
];
