import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../test-helpers.js';
import type { DbClient } from '../lib/db.js';

seedTestEnv();

// Import after env is seeded: auth-helpers pulls in config modules that read
// required env vars at module-load time.
const { deriveSignupProfile, ensureAccountProfile } = await import('./auth-helpers.js');

type QueryCall = { text: string; params?: unknown[] };

function fakeClient(opts: { insertReturnsId: boolean }): { client: DbClient; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client = {
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      if (text.includes('INSERT INTO identity.profiles')) {
        return { rows: opts.insertReturnsId ? [{ id: 'profile-created' }] : [], rowCount: opts.insertReturnsId ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DbClient;
  return { client, calls };
}

const COMPLETE_SIGNUP = {
  name: 'Aayush',
  interfaceLanguage: 'en',
  region: null,
  avatarUrl: 'avatar_01',
};

test('ensureAccountProfile creates the profile, members, and preferences on first call', async () => {
  const { client, calls } = fakeClient({ insertReturnsId: true });

  await ensureAccountProfile(client, 'account-1', COMPLETE_SIGNUP);

  const profileInsert = calls.find((c) => c.text.includes('INSERT INTO identity.profiles'));
  assert.ok(profileInsert, 'profile insert should run');
  assert.match(profileInsert!.text, /ON CONFLICT DO NOTHING/);
  assert.match(profileInsert!.text, /is_admin/);
  assert.match(profileInsert!.text, /\btrue\b/, 'bootstrapped profile is admin');

  assert.ok(calls.some((c) => c.text.includes('INSERT INTO identity.profile_members')));
  assert.ok(calls.some((c) => c.text.includes('INSERT INTO identity.profile_preferences')));
});

test('ensureAccountProfile does not duplicate members/preferences when the row already exists', async () => {
  const { client, calls } = fakeClient({ insertReturnsId: false });

  await ensureAccountProfile(client, 'account-1', COMPLETE_SIGNUP);

  assert.ok(calls.some((c) => c.text.includes('INSERT INTO identity.profiles')), 'conflicting insert still attempted');
  assert.equal(
    calls.filter((c) => c.text.includes('INSERT INTO identity.profile_members')).length,
    0,
    'no member row on conflict',
  );
  assert.equal(
    calls.filter((c) => c.text.includes('INSERT INTO identity.profile_preferences')).length,
    0,
    'no preference row on conflict',
  );
});

test('ensureAccountProfile serializes with a per-account advisory lock', async () => {
  const { client, calls } = fakeClient({ insertReturnsId: true });

  await ensureAccountProfile(client, 'account-1', COMPLETE_SIGNUP);

  const lockCall = calls.find((c) => c.text.includes('pg_advisory_xact_lock'));
  assert.ok(lockCall, 'advisory lock should be acquired');
  assert.equal(lockCall!.params?.[0], 'account-1');
});

test('deriveSignupProfile returns ok:true for complete metadata', () => {
  const result = deriveSignupProfile({
    user_metadata: { name: 'Aayush', interfaceLanguage: 'en', avatarUrl: 'avatar_01' },
  });
  assert.equal(result.ok, true);
});

test('deriveSignupProfile reports missing fields for incomplete metadata (drives 409)', () => {
  const result = deriveSignupProfile({ user_metadata: { name: 'Aayush' } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.missing.includes('interfaceLanguage'));
    assert.ok(result.missing.includes('avatarUrl'));
  }
});
