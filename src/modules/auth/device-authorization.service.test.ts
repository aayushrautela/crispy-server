import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('generateUserCode produces 8 base-20 chars with a dash', async () => {
  const { generateUserCode } = await import('./device-authorization.service.js');
  for (let i = 0; i < 200; i += 1) {
    const code = generateUserCode();
    assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  }
});

test('normalizeUserCode uppercases, strips punctuation, and validates length', async () => {
  const { normalizeUserCode } = await import('./device-authorization.service.js');
  assert.equal(normalizeUserCode('wdjb-mjht'), 'WDJB-MJHT');
  assert.equal(normalizeUserCode(' wdjbmjht '), 'WDJB-MJHT');
  assert.equal(normalizeUserCode('W-D-J-B-M-J-H-T'), 'WDJB-MJHT');

  assert.throws(() => normalizeUserCode('WDJ-MJHT'), (error: { statusCode?: number; code?: string }) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'invalid_user_code');
    return true;
  });
  assert.throws(() => normalizeUserCode('WDJBMJHTA'), (error: { statusCode?: number }) => {
    assert.equal(error.statusCode, 400);
    return true;
  });
});

test('poll returns expired_token for malformed device codes', async () => {
  const { DeviceAuthorizationService } = await import('./device-authorization.service.js');
  const service = new DeviceAuthorizationService();
  const result = await service.poll({ deviceCode: 'not-a-device-code' });
  assert.equal(result.kind, 'expired_token');
});
