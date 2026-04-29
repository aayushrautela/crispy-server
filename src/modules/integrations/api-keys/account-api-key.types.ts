export type AccountApiKeyStatus = 'active' | 'revoked' | 'expired';

export interface AccountApiKeyRecord {
  id: string;
  accountId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  status: AccountApiKeyStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  rotatedFromKeyId: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateAccountApiKeyInput {
  accountId: string;
  name: string;
  createdByUserId: string;
  expiresAt?: string | null;
}

export interface CreateAccountApiKeyResult {
  key: AccountApiKeyRecord;
  plaintextToken: string;
}

export interface RotateAccountApiKeyInput {
  accountId: string;
  keyId: string;
  rotatedByUserId: string;
  name?: string;
  expiresAt?: string | null;
}

export interface RevokeAccountApiKeyInput {
  accountId: string;
  keyId: string;
  revokedByUserId: string;
}
