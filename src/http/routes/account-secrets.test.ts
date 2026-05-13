import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('GET /v1/account/secrets/ai-api-key returns metadata without raw value', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const original = AccountSettingsService.prototype.getAiApiKeyMetadataForUser;
  t.after(() => {
    AccountSettingsService.prototype.getAiApiKeyMetadataForUser = original;
  });

  AccountSettingsService.prototype.getAiApiKeyMetadataForUser = async function () {
    return { appUserId: 'user-1', key: 'ai.api_key', present: true, fingerprint: 'abc123def456' } as never;
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp(registerAccountRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/account/secrets/ai-api-key',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { secret: { appUserId: string; key: string; present: boolean; fingerprint: string; value?: string } } };
  assert.equal(body.data.secret.appUserId, 'user-1');
  assert.equal(body.data.secret.key, 'ai.api_key');
  assert.equal(body.data.secret.present, true);
  assert.equal(body.data.secret.fingerprint, 'abc123def456');
  assert.equal(body.data.secret.value, undefined);
});

test('PUT /v1/account/secrets/ai-api-key returns metadata without raw value', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const original = AccountSettingsService.prototype.setAiApiKeyForUser;
  t.after(() => {
    AccountSettingsService.prototype.setAiApiKeyForUser = original;
  });

  AccountSettingsService.prototype.setAiApiKeyForUser = async function () {
    return { appUserId: 'user-1', key: 'ai.api_key', present: true, fingerprint: 'new123abc456' } as never;
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp(registerAccountRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'PUT',
    url: '/v1/account/secrets/ai-api-key',
    headers: { authorization: 'Bearer test' },
    payload: { value: 'sk-or-v1-test-key' },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { secret: { appUserId: string; key: string; present: boolean; fingerprint: string; value?: string } } };
  assert.equal(body.data.secret.appUserId, 'user-1');
  assert.equal(body.data.secret.key, 'ai.api_key');
  assert.equal(body.data.secret.present, true);
  assert.equal(body.data.secret.fingerprint, 'new123abc456');
  assert.equal(body.data.secret.value, undefined);
});

test('DELETE /v1/account/secrets/ai-api-key returns deletion status', async (t) => {
  const { AccountSettingsService } = await import('../../modules/users/account-settings.service.js');
  const original = AccountSettingsService.prototype.clearAiApiKeyForUser;
  t.after(() => {
    AccountSettingsService.prototype.clearAiApiKeyForUser = original;
  });

  AccountSettingsService.prototype.clearAiApiKeyForUser = async function () {
    return true;
  };

  const { registerAccountRoutes } = await import('./account.js');
  const app = await buildTestApp(registerAccountRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({
    method: 'DELETE',
    url: '/v1/account/secrets/ai-api-key',
    headers: { authorization: 'Bearer test' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.deleted, true);
});
