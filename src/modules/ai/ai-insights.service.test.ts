import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbClient } from '../../lib/db.js';
import { seedTestEnv } from '../../test-helpers.js';
import type { AiInsightsPayload } from './ai.types.js';
import type { AiGenerationGateway } from './ai-generation.gateway.js';

seedTestEnv();

const ITEM_ID = '00000000000000000000000000000001';
const CONTENT_ID = '00000000-0000-0000-0000-000000000001';
const LOCALE = 'en-US';
const VERSION = 'v6:openai:gpt-4o-mini';

async function loadServiceClass() {
  const { AiInsightsService } = await import('./ai-insights.service.js');
  return AiInsightsService;
}

function validPayload(): AiInsightsPayload {
  return {
    the_good_stuff: 'Great stuff',
    the_catch: 'A real catch',
    standout_element: { tag: 'PERFORMANCE', focus: 'Lead actor', context: 'Carries the film' },
    trivia: 'A fun fact',
  };
}

function titleDetail(): never {
  return {
    Item: {
      mediaType: 'movie',
      title: 'Test Movie',
      overview: 'A test overview',
      year: 2020,
      rating: 7.5,
      genres: ['Drama'],
      providerIds: { tmdb: '123' },
      images: { artwork: { small: 's', medium: 'm', large: 'l' } },
    },
    NextEpisode: null,
    Videos: [],
    Cast: [],
    Creators: [],
    Directors: [],
    Production: {},
  } as never;
}

function runInTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  return work({} as DbClient);
}

type CacheRow = { payload: AiInsightsPayload; backdropPaths: string[] | null };
type CacheRepo = {
  findByKey: (client: never, k: { contentId: string; locale: string; generationVersion: string }) => Promise<CacheRow | null>;
  upsert: (client: never, p: { contentId: string; locale: string; generationVersion: string; payload: AiInsightsPayload; backdropPaths: string[] }) => Promise<AiInsightsPayload>;
  updateBackdropPaths: (client: never, p: { contentId: string; locale: string; generationVersion: string; backdropPaths: string[] }) => Promise<void>;
};

function makeCacheStore() {
  const rows = new Map<string, CacheRow>();
  const keyOf = (k: { contentId: string; locale: string; generationVersion: string }) => `${k.contentId}|${k.locale}|${k.generationVersion}`;
  const repo: CacheRepo = {
    findByKey: async (_c, k) => rows.get(keyOf(k)) ?? null,
    upsert: async (_c, p) => {
      rows.set(keyOf(p), { payload: p.payload, backdropPaths: p.backdropPaths });
      return p.payload;
    },
    updateBackdropPaths: async (_c, p) => {
      const existing = rows.get(keyOf(p));
      if (existing) rows.set(keyOf(p), { ...existing, backdropPaths: p.backdropPaths });
    },
  };
  return { rows, repo };
}

function makeGateway(cacheRepo: CacheRepo) {
  const seen = new Map<string, true>();
  let enqueueCount = 0;
  let waitCount = 0;
  const gateway: AiGenerationGateway = {
    async enqueueInsights(params) {
      const id = `${params.contentId}|${params.locale}|${params.generationVersion}`;
      // Simulate the deterministic-id job dedupe: one generation per id.
      if (!seen.has(id)) {
        seen.set(id, true);
        enqueueCount += 1;
        // Simulate the worker: generate and write the cache row.
        await cacheRepo.upsert({} as never, {
          contentId: params.contentId,
          locale: params.locale,
          generationVersion: params.generationVersion,
          payload: validPayload(),
          backdropPaths: ['/a.jpg', '/b.jpg'],
        });
      }
      return { jobId: id };
    },
    async waitForInsights() {
      waitCount += 1;
    },
  };
  return { gateway, enqueueCount: () => enqueueCount, waitCount: () => waitCount };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(AiInsightsService: any, cacheRepo: CacheRepo, gateway: AiGenerationGateway) {
  return new AiInsightsService(
    { requireOwnedProfile: async () => ({ id: 'profile-1' }) } as never,
    cacheRepo as never,
    {} as never,
    { resolveAiRequestForUser: async () => ({ providerId: 'openai', model: 'gpt-4o-mini' }) } as never,
    {} as never,
    { getTitlePage: async () => titleDetail() } as never,
    {} as never,
    { request: async () => ({ backdrops: [] }) } as never,
    runInTransaction,
    gateway,
  );
}

test('cache hit with stored backdrops performs zero TMDB and zero enqueues', async () => {
  const AiInsightsService = await loadServiceClass();
  const { rows, repo } = makeCacheStore();
  rows.set(`${CONTENT_ID}|${LOCALE}|${VERSION}`, { payload: validPayload(), backdropPaths: ['/a.jpg', '/b.jpg'] });
  const { gateway, enqueueCount, waitCount } = makeGateway(repo);

  const result = await buildService(AiInsightsService, repo, gateway).getInsights('user-1', { itemId: ITEM_ID, profileId: 'profile-1', locale: LOCALE });

  assert.equal(enqueueCount(), 0);
  assert.equal(waitCount(), 0);
  assert.equal((result as { slides: unknown[] }).slides.length, 4);
});

test('legacy cache hit without backdrops self-heals by fetching once and writing back', async () => {
  const AiInsightsService = await loadServiceClass();
  const { rows, repo } = makeCacheStore();
  rows.set(`${CONTENT_ID}|${LOCALE}|${VERSION}`, { payload: validPayload(), backdropPaths: null });
  let tmdbCalls = 0;
  const gateway = {
    async enqueueInsights() { throw new Error('should not enqueue'); },
    async waitForInsights() { throw new Error('should not wait'); },
  } as unknown as AiGenerationGateway;

  const service = new AiInsightsService(
    { requireOwnedProfile: async () => ({ id: 'profile-1' }) } as never,
    repo as never,
    {} as never,
    { resolveAiRequestForUser: async () => ({ providerId: 'openai', model: 'gpt-4o-mini' }) } as never,
    {} as never,
    { getTitlePage: async () => titleDetail() } as never,
    {} as never,
    { request: async () => { tmdbCalls += 1; return { backdrops: [{ file_path: '/a.jpg' }, { file_path: '/b.jpg' }] }; } } as never,
    runInTransaction,
    gateway,
  );

  const result = await service.getInsights('user-1', { itemId: ITEM_ID, profileId: 'profile-1', locale: LOCALE });

  assert.equal(tmdbCalls, 1);
  const row = rows.get(`${CONTENT_ID}|${LOCALE}|${VERSION}`)!;
  assert.deepEqual(row.backdropPaths, ['/a.jpg', '/b.jpg']);
  assert.equal((result as { slides: unknown[] }).slides.length, 4);
});

test('cache miss enqueues once, waits, then serves the generated result', async () => {
  const AiInsightsService = await loadServiceClass();
  const { repo } = makeCacheStore();
  const { gateway, enqueueCount, waitCount } = makeGateway(repo);

  const result = await buildService(AiInsightsService, repo, gateway).getInsights('user-1', { itemId: ITEM_ID, profileId: 'profile-1', locale: LOCALE });

  assert.equal(enqueueCount(), 1);
  assert.equal(waitCount(), 1);
  assert.equal((result as { slides: unknown[] }).slides.length, 4);
});

test('concurrent cold misses for the same key coalesce into a single generation', async () => {
  const AiInsightsService = await loadServiceClass();
  const { repo } = makeCacheStore();
  const { gateway, enqueueCount } = makeGateway(repo);

  const service = buildService(AiInsightsService, repo, gateway);
  const [first, second] = await Promise.all([
    service.getInsights('user-1', { itemId: ITEM_ID, profileId: 'profile-1', locale: LOCALE }),
    service.getInsights('user-2', { itemId: ITEM_ID, profileId: 'profile-2', locale: LOCALE }),
  ]);

  assert.equal(enqueueCount(), 1);
  assert.equal((first as { slides: unknown[] }).slides.length, 4);
  assert.equal((second as { slides: unknown[] }).slides.length, 4);
});

test('still serves the row when the wait rejects but the worker wrote the cache', async () => {
  const AiInsightsService = await loadServiceClass();
  const { repo } = makeCacheStore();
  // Simulates BullMQ waitUntilFinished missing the completion event (or a
  // QueueEvents readiness race): the worker DID upsert the row, but the wait
  // rejects. The re-read after the wait must still serve it.
  const flakyWaitGateway: AiGenerationGateway = {
    async enqueueInsights(params) {
      await repo.upsert({} as never, {
        contentId: params.contentId,
        locale: params.locale,
        generationVersion: params.generationVersion,
        payload: validPayload(),
        backdropPaths: ['/a.jpg'],
      });
      return { jobId: 'x' };
    },
    async waitForInsights() {
      throw new Error('Job timed out before finishing');
    },
  };

  const service = buildService(AiInsightsService, repo, flakyWaitGateway);
  const result = await service.getInsights('user-1', { itemId: ITEM_ID, profileId: 'profile-1', locale: LOCALE });

  assert.equal((result as { slides: unknown[] }).slides.length, 4);
});

test('cache miss that never generates surfaces a 504 timeout', async () => {
  const AiInsightsService = await loadServiceClass();
  const { repo } = makeCacheStore();
  const neverResolvingGateway: AiGenerationGateway = {
    async enqueueInsights() {
      return { jobId: 'x' };
    },
    async waitForInsights() {},
  };

  const service = new AiInsightsService(
    { requireOwnedProfile: async () => ({ id: 'profile-1' }) } as never,
    repo as never,
    {} as never,
    { resolveAiRequestForUser: async () => ({ providerId: 'openai', model: 'gpt-4o-mini' }) } as never,
    {} as never,
    { getTitlePage: async () => titleDetail() } as never,
    {} as never,
    { request: async () => ({ backdrops: [] }) } as never,
    runInTransaction,
    neverResolvingGateway,
  );

  await assert.rejects(
    () => service.getInsights('user-1', { itemId: ITEM_ID, profileId: 'profile-1', locale: LOCALE }),
    (err: Error & { statusCode?: number }) => err.statusCode === 504,
  );
});