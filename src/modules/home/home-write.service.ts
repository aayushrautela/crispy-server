import { createHash } from 'crypto';
import { withTransaction } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { HttpError } from '../../lib/errors.js';
import type { ContentIdentityService } from '../identity/content-identity.service.js';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { inferMediaIdentity, type MediaIdentity, type SupportedMediaType, type SupportedProvider } from '../identity/media-key.js';
import type { HomeListsRepo } from './repos/home-lists.repo.js';
import { DefaultHomeWritePolicy, type HomeWritePolicy } from './home-list-policy.js';
import type {
  HomeMode,
  HomeSource,
  HomeWriteActor,
  HomeWriteInput,
  HomeWriteItem,
  HomeWriteList,
  HomeWriteResult,
} from './home-types.js';

export interface Clock { now(): Date }

export interface HomeWriteService {
  writeHome(input: HomeWriteInput): Promise<HomeWriteResult>;
  clearHome(input: { accountId: string; profileId: string; source: HomeSource; idempotencyKey: string; actor: HomeWriteActor }): Promise<HomeWriteResult>;
}

/**
 * Normalize an external source label (e.g. 'official-recommender') onto the
 * three storage sources. Any non-custom, non-fallback app source maps to 'reco'.
 */
export function toStorageSource(source: string): HomeSource {
  if (source === 'custom') return 'custom';
  if (source === 'fallback') return 'fallback';
  return 'reco';
}

function homeCacheKey(profileId: string): string {
  return `home:${profileId}`;
}

export class DefaultHomeWriteService implements HomeWriteService {
  private readonly policy: HomeWritePolicy;

  constructor(
    private readonly deps: {
      repo: HomeListsRepo;
      contentIdentityService: ContentIdentityService;
      policy?: HomeWritePolicy;
      clock: Clock;
    },
  ) {
    this.policy = deps.policy ?? new DefaultHomeWritePolicy();
  }

  async writeHome(input: HomeWriteInput): Promise<HomeWriteResult> {
    if (!input.idempotencyKey) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    const source = toStorageSource(input.source);
    const decision = this.policy.authorize({ actor: input.actor, source });
    if (!decision.allowed) throw new HttpError(403, decision.rejectReason ?? 'Home write denied.', undefined, 'HOME_WRITE_DENIED');

    const actorKey = this.buildActorKey(input.actor);
    const operationKey = `${input.accountId}:${input.profileId}:${source}`;
    const requestHash = this.hashRequest(input);
    const existing = await this.deps.repo.findIdempotencyRecord({ actorKey, operationKey, idempotencyKey: input.idempotencyKey });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new HttpError(409, 'Idempotency-Key was reused with a different request.', undefined, 'IDEMPOTENCY_CONFLICT');
      return { ...(existing.responseBody as HomeWriteResult), status: 'idempotent_replay', idempotency: { key: input.idempotencyKey, replayed: true } };
    }

    const now = this.deps.clock.now();
    const lists = await this.normalizeLists(input);
    const result: HomeWriteResult = {
      accountId: input.accountId,
      profileId: input.profileId,
      source,
      status: 'written',
      listsWritten: lists.length,
      itemCount: lists.reduce((sum, list) => sum + list.items.length, 0),
      idempotency: { key: input.idempotencyKey, replayed: false },
      createdAt: now,
    };

    await withTransaction(async (client) => {
      const versioned = await Promise.all(
        lists.map(async (list) => {
          const version = await this.deps.repo.nextVersion({
            accountId: input.accountId,
            profileId: input.profileId,
            source,
            listKey: list.listKey,
          });
          return {
            accountId: input.accountId,
            profileId: input.profileId,
            source,
            listKey: list.listKey,
            sectionType: list.sectionType,
            title: list.title,
            subtitle: list.subtitle ?? null,
            items: list.items,
            actor: input.actor,
            version,
            createdAt: now,
            updatedAt: now,
          };
        }),
      );
      await this.deps.repo.replaceHomeForSource(client, {
        accountId: input.accountId,
        profileId: input.profileId,
        source,
        lists: versioned,
      });
    });

    await redis.del(homeCacheKey(input.profileId));
    await this.deps.repo.saveIdempotencyRecord({ actorKey, operationKey, idempotencyKey: input.idempotencyKey, requestHash, responseBody: result, createdAt: now });
    return result;
  }

  async clearHome(input: { accountId: string; profileId: string; source: HomeSource | string; idempotencyKey: string; actor: HomeWriteActor }): Promise<HomeWriteResult> {
    if (!input.idempotencyKey) throw new HttpError(400, 'Idempotency-Key is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');
    const source = toStorageSource(input.source);
    const decision = this.policy.authorize({ actor: input.actor, source });
    if (!decision.allowed) throw new HttpError(403, decision.rejectReason ?? 'Home write denied.', undefined, 'HOME_WRITE_DENIED');
    const now = this.deps.clock.now();
    await this.deps.repo.clearHomeForSource({ accountId: input.accountId, profileId: input.profileId, source, clearedAt: now });
    await redis.del(homeCacheKey(input.profileId));
    const result: HomeWriteResult = {
      accountId: input.accountId,
      profileId: input.profileId,
      source,
      status: 'cleared',
      listsWritten: 0,
      itemCount: 0,
      idempotency: { key: input.idempotencyKey, replayed: false },
      createdAt: now,
    };
    const actorKey = this.buildActorKey(input.actor);
    const operationKey = `${input.accountId}:${input.profileId}:${source}:clear`;
    await this.deps.repo.saveIdempotencyRecord({ actorKey, operationKey, idempotencyKey: input.idempotencyKey, requestHash: this.hashRequest(result), responseBody: result, createdAt: now });
    return result;
  }

  private async normalizeLists(input: HomeWriteInput): Promise<Array<{ listKey: string; sectionType: HomeWriteList['sectionType']; title: string; subtitle: string | null; items: unknown[] }>> {
    const normalized: Array<{ listKey: string; sectionType: HomeWriteList['sectionType']; title: string; subtitle: string | null; items: unknown[] }> = [];
    const seenListKeys = new Set<string>();
    for (const list of input.lists) {
      if (seenListKeys.has(list.listKey)) throw new HttpError(400, `Duplicate listKey ${list.listKey}.`, { field: 'lists' }, 'DUPLICATE_LIST_KEY');
      seenListKeys.add(list.listKey);
      this.policy.validateListKey(list.listKey);
      this.policy.validateSection(list.sectionType, list.items);
      const items = await this.resolveItems(list.items);
      normalized.push({ listKey: list.listKey, sectionType: list.sectionType, title: list.title, subtitle: list.subtitle ?? null, items });
    }
    return normalized;
  }

  private async resolveItems(items: HomeWriteItem[]): Promise<unknown[]> {
    const identities: MediaIdentity[] = items.map((item, index) => {
      const ref = item.providerRefs[0];
      if (!ref) throw new HttpError(400, `items[${index}].providerRefs must contain at least one provider ref.`, { field: `items[${index}].providerRefs` }, 'INVALID_PROVIDER_REF');
      const mediaType: SupportedMediaType = item.type === 'tv' ? 'show' : 'movie';
      const provider: SupportedProvider = ref.provider === 'tvdb' || ref.provider === 'imdb' || ref.provider === 'kitsu' ? ref.provider : 'tmdb';
      return inferMediaIdentity({
        mediaType,
        provider,
        providerId: ref.providerId,
        tmdbId: provider === 'tmdb' ? Number(ref.providerId) : null,
        providerMetadata: item.metadata,
      });
    });
    const resolved = await withTransaction((client) => this.deps.contentIdentityService.ensureContentIds(client, identities));
    return items.map((item, index) => {
      const identity = identities[index];
      const contentId = identity?.mediaKey ? resolved.get(identity.mediaKey) : undefined;
      if (!contentId) {
        const ref = item.providerRefs[0];
        throw new HttpError(422, `Unable to resolve item ${item.type} ${ref?.provider}:${ref?.providerId}.`, { ref }, 'ITEM_UNRESOLVABLE');
      }
      const ref = item.providerRefs[0] as { provider: 'tmdb' | 'tvdb' | 'imdb' | 'kitsu' | 'trakt'; providerId: string };
      return {
        itemId: encodePublicItemId(contentId),
        contentId,
        sourceRef: { provider: ref.provider, providerId: ref.providerId },
        rank: item.rank ?? index + 1,
        score: item.score ?? null,
        reason: item.reason ?? null,
        reasonCodes: item.reasonCodes ?? [],
      };
    });
  }

  private buildActorKey(actor: HomeWriteActor): string {
    return actor.type === 'app' ? `app:${actor.appId}:${actor.keyId}` : `account:${actor.accountId}:${actor.userId ?? 'unknown'}`;
  }

  private hashRequest(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
}

export type { HomeMode };
