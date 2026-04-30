import type { FastifyRequest } from 'fastify';
import { AppAuthError } from './app-auth.errors.js';
import type { AppGrantRepo } from './app-grant.repo.js';
import type { AppKeyRepo } from './app-key.repo.js';
import type { AppKeyHasher } from './app-key-hasher.js';
import type { AppRegistryRepo } from './app-registry.repo.js';
import type { AppSourceOwnershipRepo } from './app-source-ownership.repo.js';
import type { Clock } from './clock.js';
import type { AppKeyRecord, AppPrincipal, AppScope } from './app-principal.types.js';

export interface AppCredential {
  scheme: 'AppKey' | 'Bearer';
  keyId: string;
  secretOrSignature: string;
}

export interface AppAuthService {
  authenticateRequest(request: FastifyRequest): Promise<AppPrincipal>;
  parseAuthorizationHeader(value?: string): AppCredential;
  assertScope(principal: AppPrincipal, requiredScope: AppScope): void;
}

export class DefaultAppAuthService implements AppAuthService {
  constructor(
    private readonly deps: {
      appRegistryRepo: AppRegistryRepo;
      appKeyRepo: AppKeyRepo;
      appGrantRepo: AppGrantRepo;
      sourceOwnershipRepo: AppSourceOwnershipRepo;
      keyHasher: AppKeyHasher;
      clock: Clock;
    },
  ) {}

  async authenticateRequest(request: FastifyRequest): Promise<AppPrincipal> {
    const credential = this.parseAuthorizationHeader(request.headers.authorization);
    const key = await this.deps.appKeyRepo.findKeyById(credential.keyId);
    if (!key) {
      throw new AppAuthError({ code: 'invalid_app_credentials', message: 'Invalid app credentials.', statusCode: 401 });
    }

    const validSecret = await this.deps.keyHasher.verifySecret({
      secret: credential.secretOrSignature,
      expectedHash: key.keyHash,
    });
    if (!validSecret) {
      throw new AppAuthError({ code: 'invalid_app_credentials', message: 'Invalid app credentials.', statusCode: 401 });
    }

    const now = this.deps.clock.now();
    if (key.status !== 'active') {
      throw new AppAuthError({ code: 'app_key_disabled', message: 'App key is not active.', statusCode: 403 });
    }
    if (key.expiresAt && key.expiresAt <= now) {
      throw new AppAuthError({ code: 'app_key_expired', message: 'App key has expired.', statusCode: 401 });
    }

    const principal = await this.buildPrincipal({ key, request });
    await this.deps.appKeyRepo.updateLastUsedAt(key.keyId, now);
    return principal;
  }

  parseAuthorizationHeader(value?: string): AppCredential {
    const header = value?.trim();
    if (!header) {
      throw new AppAuthError({ code: 'missing_app_credentials', message: 'Missing app credentials.', statusCode: 401 });
    }

    if (header.startsWith('AppKey ')) {
      return parseCredentialParts('AppKey', header.slice('AppKey '.length));
    }

    if (header.startsWith('Bearer ')) {
      return parseCredentialParts('Bearer', header.slice('Bearer '.length));
    }

    throw new AppAuthError({ code: 'missing_app_credentials', message: 'Missing app credentials.', statusCode: 401 });
  }

  assertScope(principal: AppPrincipal, requiredScope: AppScope): void {
    if (!principal.scopes.includes(requiredScope)) {
      throw new AppAuthError({
        code: 'app_scope_missing',
        message: `Missing required app scope: ${requiredScope}`,
        statusCode: 403,
      });
    }
  }

  async buildPrincipal(input: { key: AppKeyRecord; request: FastifyRequest }): Promise<AppPrincipal> {
    const registryEntry = await this.deps.appRegistryRepo.findAppById(input.key.appId);
    if (!registryEntry) {
      throw new AppAuthError({ code: 'invalid_app_credentials', message: 'Invalid app credentials.', statusCode: 401 });
    }
    if (registryEntry.status !== 'active') {
      throw new AppAuthError({ code: 'app_disabled', message: 'App is not active.', statusCode: 403 });
    }

    const now = this.deps.clock.now();
    const [scopes, grants, ownerships, rateLimitPolicy] = await Promise.all([
      this.deps.appRegistryRepo.listScopesForApp(input.key.appId),
      this.deps.appGrantRepo.listActiveGrantsForApp(input.key.appId, now),
      this.deps.sourceOwnershipRepo.findByAppId(input.key.appId),
      this.deps.appRegistryRepo.getRateLimitPolicy(input.key.appId),
    ]);

    return {
      principalType: 'app',
      appId: input.key.appId,
      keyId: input.key.keyId,
      scopes,
      grants,
      ownedSources: ownerships.filter((item) => item.status === 'active').map((item) => item.source),
      ownedListKeys: [...new Set(ownerships.flatMap((item) => item.allowedListKeys))],
      rateLimitPolicy,
      registryEntry,
    };
  }
}

function parseCredentialParts(scheme: 'AppKey' | 'Bearer', value: string): AppCredential {
  const trimmed = value.trim();
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex <= 0 || colonIndex === trimmed.length - 1) {
    throw new AppAuthError({ code: 'missing_app_credentials', message: 'Missing app credentials.', statusCode: 401 });
  }
  return {
    scheme,
    keyId: trimmed.slice(0, colonIndex),
    secretOrSignature: trimmed.slice(colonIndex + 1),
  };
}
