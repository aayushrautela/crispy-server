import { withDbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import type { AuthActor } from '../auth/auth.types.js';
import { PublicAccountAccessService } from './public-account-access.service.js';
import { PublicRecommendationWriteRepo } from './public-recommendation-write.repo.js';
import { PublicTasteWriteRepo } from './public-taste-write.repo.js';
import { PublicAccountWriteIdempotencyRepo, hashIdempotencyKey, buildOperationKey, computeIdempotencyExpiry } from './public-account-write-idempotency.repo.js';
import { validatePublicListKeyForWrite, normalizePublicRecommendationListInput, normalizePublicTasteProfileInput, parsePublicWriteIfMatchHeader, normalizeAndValidateIdempotencyKey, hashPublicWriteRequest } from './public-account-write.validation.js';
import { actorFromAuthActor, etagForVersion, type PublicWriteServiceResult } from './public-account-write.types.js';
import type { ReplacePublicRecommendationListRequest, ReplacePublicTasteProfileRequest, PublicRecommendationWriteResponse, PublicTasteWriteResponse } from './public-account-write.contracts.js';

export class PublicAccountWriteService {
  constructor(
    private readonly accessService = new PublicAccountAccessService(),
    private readonly recommendationRepo = new PublicRecommendationWriteRepo(),
    private readonly tasteRepo = new PublicTasteWriteRepo(),
    private readonly idempotencyRepo = new PublicAccountWriteIdempotencyRepo(),
  ) {}

  async replaceRecommendationList(input: {
    actor: AuthActor;
    profileId: string;
    listKey: string;
    body: unknown;
    idempotencyKey?: string;
    ifMatch?: string;
  }): Promise<PublicWriteServiceResult<PublicRecommendationWriteResponse>> {
    const normalizedListKey = validatePublicListKeyForWrite(input.listKey);
    const normalized = normalizePublicRecommendationListInput(input.body);
    const idempotencyKey = normalizeAndValidateIdempotencyKey(input.idempotencyKey);
    const ifMatchVersion = parsePublicWriteIfMatchHeader(input.ifMatch);
    const writeActor = actorFromAuthActor(input.actor);

    this.accessService.requireScope(input.actor, 'recommendations:write');
    await withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, input.actor, input.profileId);
    });

    const operationKey = buildOperationKey({ method: 'PUT', routePattern: '/api/account/v1/profiles/:profileId/recommendations/:listKey', profileId: input.profileId, listKey: normalizedListKey });
    const idempotencyKeyHash = idempotencyKey ? hashIdempotencyKey(idempotencyKey) : undefined;

    if (idempotencyKeyHash) {
      const stored = await withDbClient((client) => this.idempotencyRepo.findActive(client, {
        accountId: writeActor.accountId,
        principalType: writeActor.type,
        principalId: writeActor.id,
        operationKey,
        idempotencyKeyHash,
        now: new Date(),
      }));
      if (stored) {
        if (stored.requestHash !== normalized.requestHash) {
          throw new HttpError(409, 'Idempotency key conflict.', undefined, 'IDEMPOTENCY_CONFLICT');
        }
        return {
          response: stored.responseJson as PublicRecommendationWriteResponse,
          created: false,
          version: (stored.responseJson as PublicRecommendationWriteResponse).version,
          etag: (stored.responseJson as PublicRecommendationWriteResponse).etag,
          status: stored.responseStatus,
        };
      }
    }

    const result = await withDbClient(async (client) => {
      return this.recommendationRepo.upsertCurrentList(client, {
        accountId: writeActor.accountId,
        profileId: input.profileId,
        listKey: normalizedListKey,
        schemaVersion: normalized.schemaVersion,
        mediaType: normalized.mediaType,
        locale: normalized.locale,
        summary: normalized.summary,
        itemsJson: normalized.items,
        requestHash: normalized.requestHash,
        actor: writeActor,
        ifMatchVersion,
        idempotencyKeyHash,
      });
    });

    const response: PublicRecommendationWriteResponse = {
      profileId: input.profileId,
      listKey: normalizedListKey,
      source: 'account_api',
      version: result.record.version,
      itemCount: result.record.itemCount,
      created: result.created,
      updatedAt: result.record.updatedAt,
      etag: etagForVersion(result.record.version),
    };

    const status = result.created ? 201 : 200;
    if (idempotencyKeyHash) {
      await withDbClient((client) => this.idempotencyRepo.insert(client, {
        accountId: writeActor.accountId,
        principalType: writeActor.type,
        principalId: writeActor.id,
        operationKey,
        idempotencyKeyHash,
        requestHash: normalized.requestHash,
        responseStatus: status,
        responseJson: response,
        expiresAt: computeIdempotencyExpiry(new Date()),
      }));
    }

    return { response, created: result.created, version: result.record.version, etag: response.etag, status };
  }

  async clearRecommendationList(input: {
    actor: AuthActor;
    profileId: string;
    listKey: string;
    idempotencyKey?: string;
    ifMatch?: string;
  }): Promise<PublicWriteServiceResult<null>> {
    const normalizedListKey = validatePublicListKeyForWrite(input.listKey);
    const idempotencyKey = normalizeAndValidateIdempotencyKey(input.idempotencyKey);
    const ifMatchVersion = parsePublicWriteIfMatchHeader(input.ifMatch);
    const writeActor = actorFromAuthActor(input.actor);

    this.accessService.requireScope(input.actor, 'recommendations:write');
    await withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, input.actor, input.profileId);
    });

    const operationKey = buildOperationKey({ method: 'DELETE', routePattern: '/api/account/v1/profiles/:profileId/recommendations/:listKey', profileId: input.profileId, listKey: normalizedListKey });
    const requestHash = hashPublicWriteRequest({ method: 'DELETE', profileId: input.profileId, listKey: normalizedListKey });
    const idempotencyKeyHash = idempotencyKey ? hashIdempotencyKey(idempotencyKey) : undefined;

    if (idempotencyKeyHash) {
      const stored = await withDbClient((client) => this.idempotencyRepo.findActive(client, {
        accountId: writeActor.accountId,
        principalType: writeActor.type,
        principalId: writeActor.id,
        operationKey,
        idempotencyKeyHash,
        now: new Date(),
      }));
      if (stored) {
        if (stored.requestHash !== requestHash) {
          throw new HttpError(409, 'Idempotency key conflict.', undefined, 'IDEMPOTENCY_CONFLICT');
        }
        return { response: null, created: false, version: 0, etag: '', status: 204 };
      }
    }

    const deletedVersion = await withDbClient(async (client) => {
      return this.recommendationRepo.softDeleteCurrentList(client, {
        accountId: writeActor.accountId,
        profileId: input.profileId,
        listKey: normalizedListKey,
        actor: writeActor,
        ifMatchVersion,
        idempotencyKeyHash,
      });
    });

    if (idempotencyKeyHash) {
      await withDbClient((client) => this.idempotencyRepo.insert(client, {
        accountId: writeActor.accountId,
        principalType: writeActor.type,
        principalId: writeActor.id,
        operationKey,
        idempotencyKeyHash,
        requestHash,
        responseStatus: 204,
        responseJson: null,
        expiresAt: computeIdempotencyExpiry(new Date()),
      }));
    }

    return { response: null, created: false, version: deletedVersion ?? 0, etag: '', status: 204 };
  }

  async replaceTasteProfile(input: {
    actor: AuthActor;
    profileId: string;
    body: unknown;
    idempotencyKey?: string;
    ifMatch?: string;
  }): Promise<PublicWriteServiceResult<PublicTasteWriteResponse>> {
    const normalized = normalizePublicTasteProfileInput(input.body);
    const idempotencyKey = normalizeAndValidateIdempotencyKey(input.idempotencyKey);
    const ifMatchVersion = parsePublicWriteIfMatchHeader(input.ifMatch);
    const writeActor = actorFromAuthActor(input.actor);

    this.accessService.requireScope(input.actor, 'taste:write');
    await withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, input.actor, input.profileId);
    });

    const operationKey = buildOperationKey({ method: 'PUT', routePattern: '/api/account/v1/profiles/:profileId/taste/current', profileId: input.profileId });
    const idempotencyKeyHash = idempotencyKey ? hashIdempotencyKey(idempotencyKey) : undefined;

    if (idempotencyKeyHash) {
      const stored = await withDbClient((client) => this.idempotencyRepo.findActive(client, {
        accountId: writeActor.accountId,
        principalType: writeActor.type,
        principalId: writeActor.id,
        operationKey,
        idempotencyKeyHash,
        now: new Date(),
      }));
      if (stored) {
        if (stored.requestHash !== normalized.requestHash) {
          throw new HttpError(409, 'Idempotency key conflict.', undefined, 'IDEMPOTENCY_CONFLICT');
        }
        return {
          response: stored.responseJson as PublicTasteWriteResponse,
          created: false,
          version: (stored.responseJson as PublicTasteWriteResponse).version,
          etag: (stored.responseJson as PublicTasteWriteResponse).etag,
          status: stored.responseStatus,
        };
      }
    }

    const result = await withDbClient(async (client) => {
      return this.tasteRepo.upsertCurrentTaste(client, {
        accountId: writeActor.accountId,
        profileId: input.profileId,
        schemaVersion: normalized.schemaVersion,
        summary: normalized.summary,
        locale: normalized.locale,
        signalsJson: normalized.signals,
        requestHash: normalized.requestHash,
        actor: writeActor,
        ifMatchVersion,
        idempotencyKeyHash,
      });
    });

    const response: PublicTasteWriteResponse = {
      profileId: input.profileId,
      source: 'account_api',
      version: result.record.version,
      signalCount: result.record.signalCount,
      created: result.created,
      updatedAt: result.record.updatedAt,
      etag: etagForVersion(result.record.version),
    };

    const status = result.created ? 201 : 200;
    if (idempotencyKeyHash) {
      await withDbClient((client) => this.idempotencyRepo.insert(client, {
        accountId: writeActor.accountId,
        principalType: writeActor.type,
        principalId: writeActor.id,
        operationKey,
        idempotencyKeyHash,
        requestHash: normalized.requestHash,
        responseStatus: status,
        responseJson: response,
        expiresAt: computeIdempotencyExpiry(new Date()),
      }));
    }

    return { response, created: result.created, version: result.record.version, etag: response.etag, status };
  }

  async clearTasteProfile(input: {
    actor: AuthActor;
    profileId: string;
    idempotencyKey?: string;
    ifMatch?: string;
  }): Promise<PublicWriteServiceResult<null>> {
    const idempotencyKey = normalizeAndValidateIdempotencyKey(input.idempotencyKey);
    const ifMatchVersion = parsePublicWriteIfMatchHeader(input.ifMatch);
    const writeActor = actorFromAuthActor(input.actor);

    this.accessService.requireScope(input.actor, 'taste:write');
    await withDbClient(async (client) => {
      await this.accessService.requireOwnedProfile(client, input.actor, input.profileId);
    });

    const operationKey = buildOperationKey({ method: 'DELETE', routePattern: '/api/account/v1/profiles/:profileId/taste/current', profileId: input.profileId });
    const requestHash = hashPublicWriteRequest({ method: 'DELETE', profileId: input.profileId });
    const idempotencyKeyHash = idempotencyKey ? hashIdempotencyKey(idempotencyKey) : undefined;

    if (idempotencyKeyHash) {
      const stored = await withDbClient((client) => this.idempotencyRepo.findActive(client, {
        accountId: writeActor.accountId,
        principalType: writeActor.type,
        principalId: writeActor.id,
        operationKey,
        idempotencyKeyHash,
        now: new Date(),
      }));
      if (stored) {
        if (stored.requestHash !== requestHash) {
          throw new HttpError(409, 'Idempotency key conflict.', undefined, 'IDEMPOTENCY_CONFLICT');
        }
        return { response: null, created: false, version: 0, etag: '', status: 204 };
      }
    }

    const deletedVersion = await withDbClient(async (client) => {
      return this.tasteRepo.softDeleteCurrentTaste(client, {
        accountId: writeActor.accountId,
        profileId: input.profileId,
        actor: writeActor,
        ifMatchVersion,
        idempotencyKeyHash,
      });
    });

    if (idempotencyKeyHash) {
      await withDbClient((client) => this.idempotencyRepo.insert(client, {
        accountId: writeActor.accountId,
        principalType: writeActor.type,
        principalId: writeActor.id,
        operationKey,
        idempotencyKeyHash,
        requestHash,
        responseStatus: 204,
        responseJson: null,
        expiresAt: computeIdempotencyExpiry(new Date()),
      }));
    }

    return { response: null, created: false, version: deletedVersion ?? 0, etag: '', status: 204 };
  }
}
