import crypto from 'node:crypto';
import { withDbClient, withTransaction, type DbClient } from '../../../lib/db.js';
import { RecommendationSourceRepository } from '../recommendation-source.repo.js';
import type { AuthenticatedIntegrationPrincipal } from '../auth/integration-auth.types.js';
import type { MediaRef, ProviderIds } from '../media-ref.types.js';
import { IntegrationRecommendationRepository } from './integration-recommendation.repo.js';
import type {
  IntegrationRecommendationListWriteInput,
  RecommendationListRecord,
  RecommendationListWithItems,
  ValidatedRecommendationItemInput,
  ValidatedRecommendationListWriteInput,
} from './integration-recommendation.types.js';

const LIST_KEY_PATTERN = /^[a-zA-Z0-9._:-]{1,100}$/;
const MAX_ITEMS = 500;

export class IntegrationRecommendationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export class IntegrationRecommendationService {
  constructor(
    private readonly repo = new IntegrationRecommendationRepository(),
    private readonly sourceRepo = new RecommendationSourceRepository(),
  ) {}

  async putList(input: {
    principal: AuthenticatedIntegrationPrincipal;
    profileId: string;
    listKey: string;
    body: unknown;
    idempotencyKey?: string | null;
  }): Promise<RecommendationListWithItems> {
    validateListKey(input.listKey);
    const payload = validateWriteBody(input.body);
    const requestHash = hashRequest({ listKey: input.listKey, body: payload });

    return withTransaction(async (client) => {
      const source = await this.sourceRepo.ensureExternalSourceForApiKey(client, {
        accountId: input.principal.accountId,
        apiKeyId: input.principal.apiKeyId,
      });

      if (input.idempotencyKey) {
        const existing = await this.repo.findWriteRequest(client, {
          sourceId: source.id,
          profileId: input.profileId,
          listKey: input.listKey,
          idempotencyKey: input.idempotencyKey,
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new IntegrationRecommendationError(409, 'same idempotency key with different body');
          }
          const list = await this.repo.getList(client, input.principal.accountId, input.profileId, source.id, input.listKey);
          if (!list) {
            throw new IntegrationRecommendationError(409, 'idempotent write result is no longer available');
          }
          return list;
        }
      }

      return this.repo.replaceList(client, {
        accountId: input.principal.accountId,
        profileId: input.profileId,
        sourceId: source.id,
        sourceKey: source.sourceKey,
        listKey: input.listKey,
        payload,
        requestHash,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    });
  }

  async listLists(input: {
    principal: AuthenticatedIntegrationPrincipal;
    profileId: string;
    sourceKey?: string | null;
  }): Promise<RecommendationListRecord[]> {
    return withDbClient(async (client) => this.repo.listLists(client, input.principal.accountId, input.profileId, {
      sourceId: input.sourceKey ? null : await this.getDefaultSourceId(client, input.principal),
      sourceKey: input.sourceKey ?? null,
    }));
  }

  async getList(input: {
    principal: AuthenticatedIntegrationPrincipal;
    profileId: string;
    listKey: string;
    sourceKey?: string | null;
  }): Promise<RecommendationListWithItems | null> {
    validateListKey(input.listKey);
    return withDbClient(async (client) => {
      const sourceId = input.sourceKey ? null : await this.getDefaultSourceId(client, input.principal);
      if (input.sourceKey) {
        const lists = await this.repo.listLists(client, input.principal.accountId, input.profileId, { sourceKey: input.sourceKey });
        const matched = lists.find((list) => list.listKey === input.listKey);
        return matched ? this.repo.getList(client, input.principal.accountId, input.profileId, matched.sourceId, input.listKey) : null;
      }
      return this.repo.getList(client, input.principal.accountId, input.profileId, sourceId, input.listKey);
    });
  }

  private async getDefaultSourceId(client: DbClient, principal: AuthenticatedIntegrationPrincipal): Promise<string> {
    const source = await this.sourceRepo.ensureExternalSourceForApiKey(client, {
      accountId: principal.accountId,
      apiKeyId: principal.apiKeyId,
    });
    return source.id;
  }
}

function validateListKey(listKey: string): void {
  if (!LIST_KEY_PATTERN.test(listKey)) {
    throw new IntegrationRecommendationError(400, 'listKey must match ^[a-zA-Z0-9._:-]{1,100}$');
  }
}

function validateWriteBody(body: unknown): ValidatedRecommendationListWriteInput {
  if (!isObject(body)) {
    throw new IntegrationRecommendationError(400, 'request body must be an object');
  }
  const itemsValue = body.items;
  if (!Array.isArray(itemsValue)) {
    throw new IntegrationRecommendationError(400, 'items must be an array');
  }
  if (itemsValue.length > MAX_ITEMS) {
    throw new IntegrationRecommendationError(400, 'items must contain at most 500 entries');
  }

  return {
    title: optionalString(body.title, 'title'),
    description: optionalString(body.description, 'description'),
    algorithmKey: optionalString(body.algorithmKey, 'algorithmKey'),
    modelVersion: optionalString(body.modelVersion, 'modelVersion'),
    generatedAt: optionalString(body.generatedAt, 'generatedAt'),
    expiresAt: optionalString(body.expiresAt, 'expiresAt'),
    metadata: optionalObject(body.metadata, 'metadata') ?? {},
    items: itemsValue.map((item, index) => validateItem(item, index)),
  };
}

function validateItem(value: unknown, index: number): ValidatedRecommendationItemInput {
  if (!isObject(value)) {
    throw new IntegrationRecommendationError(400, `items[${index}] must be an object`);
  }
  const mediaRef = value.mediaRef;
  if (!isObject(mediaRef)) {
    throw new IntegrationRecommendationError(400, `items[${index}].mediaRef must be an object`);
  }
  if (!isMediaType(mediaRef.mediaType)) {
    throw new IntegrationRecommendationError(400, `items[${index}].mediaRef.mediaType is invalid`);
  }
  const typedMediaRef = mediaRef as Record<string, unknown> & MediaRef;
  validateProviderIds(typedMediaRef.providerIds, `items[${index}].mediaRef.providerIds`);
  validateProviderIds(typedMediaRef.seasonProviderIds, `items[${index}].mediaRef.seasonProviderIds`);
  validateProviderIds(typedMediaRef.episodeProviderIds, `items[${index}].mediaRef.episodeProviderIds`);

  if (!hasIdentity(typedMediaRef)) {
    throw new IntegrationRecommendationError(400, `items[${index}].mediaRef must include at least one identity`);
  }

  const metadataHint = optionalObject(value.metadataHint, `items[${index}].metadataHint`);
  const score = optionalFiniteNumber(value.score, `items[${index}].score`);

  return {
    position: index,
    mediaRef: typedMediaRef,
    metadataHint,
    score,
    reason: optionalString(value.reason, `items[${index}].reason`),
    reasonCode: optionalString(value.reasonCode, `items[${index}].reasonCode`),
  };
}

function hasIdentity(mediaRef: MediaRef): boolean {
  return Boolean(
    mediaRef.canonicalId
      || hasProviderIds(mediaRef.providerIds)
      || hasProviderIds(mediaRef.episodeProviderIds)
      || hasProviderIds(mediaRef.seasonProviderIds)
      || (mediaRef.series && (mediaRef.series.canonicalId || hasProviderIds(mediaRef.series.providerIds)))
      || (mediaRef.mediaType === 'episode' && typeof mediaRef.seasonNumber === 'number' && typeof mediaRef.episodeNumber === 'number')
      || (mediaRef.mediaType === 'season' && typeof mediaRef.seasonNumber === 'number'),
  );
}

function hasProviderIds(value: ProviderIds | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

function validateProviderIds(value: ProviderIds | undefined, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    throw new IntegrationRecommendationError(400, `${path} must be an object`);
  }
}

function isMediaType(value: unknown): value is MediaRef['mediaType'] {
  return value === 'movie' || value === 'series' || value === 'season' || value === 'episode';
}

function optionalString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new IntegrationRecommendationError(400, `${path} must be a string`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, path: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new IntegrationRecommendationError(400, `${path} must be a finite number`);
  }
  return value;
}

function optionalObject(value: unknown, path: string): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isObject(value)) {
    throw new IntegrationRecommendationError(400, `${path} must be an object`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashRequest(value: { listKey: string; body: ValidatedRecommendationListWriteInput }): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
