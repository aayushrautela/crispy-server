import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { AddonPayload, AddonRecord } from './addon.repo.js';
import type { DbClient } from '../../lib/db.js';

seedTestEnv();

// addon.service (via lib/db) reads required env at import time, so it must be
// imported dynamically after seedTestEnv() has run.
type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

type AddonServiceCtor = new (
  repo?: never,
  runInTransaction?: TransactionRunner,
) => import('./addon.service.js').AddonService;

async function loadServiceClass(): Promise<AddonServiceCtor> {
  const { AddonService } = await import('./addon.service.js');
  return AddonService as unknown as AddonServiceCtor;
}

function record(overrides: Partial<AddonRecord> = {}): AddonRecord {
  return {
    id: 'addon-1',
    account_id: 'acc-1',
    addon_type: 'jsplugin',
    manifest_url: 'https://example.com/repo.json',
    payload: { providerId: 'provider-1' },
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type KeyCall = {
  accountId: string;
  addonType: string;
  manifestUrl: string;
  providerId: string | null;
};

async function buildHarness(options: {
  existing?: AddonRecord | null;
  insertError?: unknown;
  existingAfterInsert?: AddonRecord | null;
}) {
  const keyCalls: KeyCall[] = [];
  const inserts: Array<{ accountId: string; addonType: string; manifestUrl: string; payload: AddonPayload }> = [];
  let keyCallCount = 0;
  const repo = {
    async findByKey(
      _client: DbClient,
      accountId: string,
      addonType: string,
      manifestUrl: string,
      providerId: string | null,
    ) {
      keyCalls.push({ accountId, addonType, manifestUrl, providerId });
      keyCallCount += 1;
      if (options.insertError && keyCallCount > 1) return options.existingAfterInsert ?? null;
      return options.existing ?? null;
    },
    async insert(
      _client: DbClient,
      accountId: string,
      addonType: string,
      manifestUrl: string,
      payload: AddonPayload,
    ) {
      inserts.push({ accountId, addonType, manifestUrl, payload });
      if (options.insertError) throw options.insertError;
      return record({ payload });
    },
  };
  const AddonService = await loadServiceClass();
  const runInTransaction: TransactionRunner = async (work) => work({} as DbClient);
  const service = new AddonService(repo as never, runInTransaction);
  return { service, keyCalls, inserts };
}

test('addAddon returns existing addon instead of 409 when key matches', async () => {
  const existing = record();
  const { service, inserts } = await buildHarness({ existing });
  const addon = await service.addAddon('acc-1', {
    manifestUrl: 'https://example.com/repo.json',
    type: 'jsplugin',
    payload: { providerId: 'provider-1' },
  });
  assert.equal(addon.id, existing.id);
  assert.equal(inserts.length, 0);
});

test('addAddon normalizes manifest URL before lookup and insert', async () => {
  const { service, keyCalls, inserts } = await buildHarness({});
  await service.addAddon('acc-1', {
    manifestUrl: 'HTTPS://EXAMPLE.com/repo.json',
    type: 'stremio',
  });
  assert.equal(keyCalls[0]!.manifestUrl, 'https://example.com/repo.json');
  assert.equal(inserts[0]!.manifestUrl, 'https://example.com/repo.json');
  assert.equal(keyCalls[0]!.addonType, 'stremio');
});

test('addAddon treats unique violation race as idempotent install', async () => {
  const raced = record({ id: 'addon-raced' });
  const { service, inserts } = await buildHarness({
    insertError: Object.assign(new Error('duplicate key'), { code: '23505' }),
    existingAfterInsert: raced,
  });
  const addon = await service.addAddon('acc-1', {
    manifestUrl: 'https://example.com/repo.json',
    type: 'jsplugin',
    payload: { providerId: 'provider-1' },
  });
  assert.equal(addon.id, 'addon-raced');
  assert.equal(inserts.length, 1);
});

test('addAddon rethrows non-unique insert errors', async () => {
  const { service } = await buildHarness({ insertError: new Error('boom') });
  await assert.rejects(
    service.addAddon('acc-1', { manifestUrl: 'https://example.com/repo.json', type: 'stremio' }),
    /boom/,
  );
});

test('addAddon rejects invalid manifest URL', async () => {
  const { service } = await buildHarness({});
  await assert.rejects(
    service.addAddon('acc-1', { manifestUrl: 'not-a-url', type: 'stremio' }),
    /valid URL/,
  );
});

test('addAddon rejects non-http protocol', async () => {
  const { service } = await buildHarness({});
  await assert.rejects(
    service.addAddon('acc-1', { manifestUrl: 'ftp://example.com/repo.json', type: 'stremio' }),
    /http or https/,
  );
});

test('addAddon requires providerId payload for jsplugin', async () => {
  const { service } = await buildHarness({});
  await assert.rejects(
    service.addAddon('acc-1', {
      manifestUrl: 'https://example.com/repo.json',
      type: 'jsplugin',
      payload: { name: 'Example' },
    }),
    /providerId/,
  );
});

test('addAddon rejects payload for stremio addons', async () => {
  const { service } = await buildHarness({});
  await assert.rejects(
    service.addAddon('acc-1', {
      manifestUrl: 'https://example.com/manifest.json',
      type: 'stremio',
      payload: { providerId: 'x' },
    }),
    /payload is only supported/,
  );
});

test('addAddon defaults missing type to stremio', async () => {
  const { service, keyCalls, inserts } = await buildHarness({});
  await service.addAddon('acc-1', { manifestUrl: 'https://example.com/manifest.json' });
  assert.equal(keyCalls[0]!.addonType, 'stremio');
  assert.equal(inserts[0]!.addonType, 'stremio');
});
