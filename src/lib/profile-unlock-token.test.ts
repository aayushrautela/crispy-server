import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../test-helpers.js';

seedTestEnv();

test('sign + verify roundtrip returns correct claims', async () => {
  const { signProfileUnlockToken, verifyProfileUnlockToken } = await import('./profile-unlock-token.js');
  const token = await signProfileUnlockToken('profile-1', 'auth-subject');
  assert.ok(typeof token === 'string' && token.length > 0);
  const payload = await verifyProfileUnlockToken(token);
  assert.equal(payload.profileId, 'profile-1');
  assert.equal(payload.sub, 'auth-subject');
  assert.equal(payload.typ, 'profile_unlock');
});

test('verify rejects arbitrary jwt with bad signature', async () => {
  const { verifyProfileUnlockToken } = await import('./profile-unlock-token.js');
  await assert.rejects(
    () => verifyProfileUnlockToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc'),
    /JWSSignatureVerificationFailed|signature verification failed/i,
  );
});

test('guard rejects token bound to a different profile', async () => {
  const { signProfileUnlockToken } = await import('./profile-unlock-token.js');
  const { requireProfileUnlock } = await import('../http/plugins/profile-unlock-guard.js');
  const tokenForOther = await signProfileUnlockToken('profile-99', 'auth-subject');

  const fakeRequest = {
    auth: { appUserId: 'auth-subject' },
    headers: { 'x-profile-unlock-token': tokenForOther },
    query: {},
  } as never;

  await assert.rejects(
    () => requireProfileUnlock(fakeRequest, 'profile-1'),
    /does not match profile|INVALID_UNLOCK_TOKEN/i,
  );
});
