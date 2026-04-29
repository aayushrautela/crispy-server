import type { AuthActor } from '../auth/auth.types.js';

export type PublicAccountWriteActorType = 'user' | 'pat';

export interface PublicAccountWriteActor {
  type: PublicAccountWriteActorType;
  id: string;
  accountId: string;
}

export interface PublicWriteServiceResult<TResponse> {
  response: TResponse;
  created: boolean;
  version: number;
  etag: string;
  status: number;
}

export function actorFromAuthActor(actor: AuthActor): PublicAccountWriteActor {
  if (!actor.appUserId) {
    throw new Error('Authenticated actor is missing app user id.');
  }
  return {
    type: actor.type === 'pat' ? 'pat' : 'user',
    id: actor.tokenId ?? actor.appUserId,
    accountId: actor.appUserId,
  };
}

export function etagForVersion(version: number): string {
  return `"${version}"`;
}
