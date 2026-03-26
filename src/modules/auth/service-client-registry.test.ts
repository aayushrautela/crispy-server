import test from 'node:test';
import assert from 'node:assert/strict';
import { ServiceClientRegistry, parseServiceClientRegistryConfig } from './service-client-registry.js';

test('parseServiceClientRegistryConfig normalizes whitespace and deduplicates scopes', () => {
  const clients = parseServiceClientRegistryConfig(JSON.stringify([{
    serviceId: ' external-recommendation-engine ',
    apiKey: ' secret-key ',
    scopes: ['profiles:read', 'watch:read', 'watch:read'],
    description: 'Engine',
  }]));

  assert.deepEqual(clients, [{
    serviceId: 'external-recommendation-engine',
    apiKey: 'secret-key',
    scopes: ['profiles:read', 'watch:read'],
    description: 'Engine',
    status: 'active',
  }]);
});

test('parseServiceClientRegistryConfig defaults status to active', () => {
  const clients = parseServiceClientRegistryConfig(JSON.stringify([{
    serviceId: 'svc',
    apiKey: 'key',
    scopes: ['profiles:read'],
  }]));

  assert.equal(clients[0]?.status, 'active');
});

test('parseServiceClientRegistryConfig accepts explicit disabled status', () => {
  const clients = parseServiceClientRegistryConfig(JSON.stringify([{
    serviceId: 'svc',
    apiKey: 'key',
    scopes: ['profiles:read'],
    status: 'disabled',
  }]));

  assert.equal(clients[0]?.status, 'disabled');
});

test('parseServiceClientRegistryConfig rejects missing serviceId', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig(JSON.stringify([{ apiKey: 'key', scopes: ['profiles:read'] }])),
    /serviceId is required/,
  );
});

test('parseServiceClientRegistryConfig rejects missing apiKey', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig(JSON.stringify([{ serviceId: 'svc', scopes: ['profiles:read'] }])),
    /apiKey is required/,
  );
});

test('parseServiceClientRegistryConfig rejects missing scopes', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig(JSON.stringify([{ serviceId: 'svc', apiKey: 'key' }])),
    /scopes are required/,
  );
});

test('parseServiceClientRegistryConfig rejects unknown scopes', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig(JSON.stringify([{ serviceId: 'svc', apiKey: 'key', scopes: ['not:real'] }])),
    /unsupported scope/,
  );
});

test('parseServiceClientRegistryConfig rejects duplicate service ids', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig(JSON.stringify([
      { serviceId: 'svc', apiKey: 'key-1', scopes: ['profiles:read'] },
      { serviceId: 'svc', apiKey: 'key-2', scopes: ['watch:read'] },
    ])),
    /duplicate serviceId/,
  );
});

test('parseServiceClientRegistryConfig rejects legacy allowedScopes alias', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig(JSON.stringify([{
      serviceId: 'svc',
      apiKey: 'key-1',
      allowedScopes: ['profiles:read'],
    }])),
    /scopes are required/,
  );
});

test('parseServiceClientRegistryConfig rejects invalid JSON', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig('not json'),
    /Invalid SERVICE_CLIENTS_JSON: expected valid JSON/,
  );
});

test('parseServiceClientRegistryConfig rejects non-array input', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig('{"serviceId": "svc"}'),
    /expected an array/,
  );
});

test('ServiceClientRegistry.authenticate returns client for valid active credentials', () => {
  const registry = new ServiceClientRegistry(parseServiceClientRegistryConfig(JSON.stringify([
    { serviceId: 'svc-active', apiKey: 'key-1', scopes: ['profiles:read'] },
  ])));

  const result = registry.authenticate('svc-active', 'key-1');
  assert.equal(result?.serviceId, 'svc-active');
});

test('ServiceClientRegistry.authenticate returns null for wrong key', () => {
  const registry = new ServiceClientRegistry(parseServiceClientRegistryConfig(JSON.stringify([
    { serviceId: 'svc-active', apiKey: 'key-1', scopes: ['profiles:read'] },
  ])));

  assert.equal(registry.authenticate('svc-active', 'wrong-key'), null);
});

test('ServiceClientRegistry.authenticate returns null for disabled clients', () => {
  const registry = new ServiceClientRegistry(parseServiceClientRegistryConfig(JSON.stringify([
    { serviceId: 'svc-disabled', apiKey: 'key-2', scopes: ['watch:read'], status: 'disabled' },
  ])));

  assert.equal(registry.authenticate('svc-disabled', 'key-2'), null);
});

test('ServiceClientRegistry.authenticate returns null for unknown service', () => {
  const registry = new ServiceClientRegistry([]);
  assert.equal(registry.authenticate('missing', 'key'), null);
});

test('ServiceClientRegistry.lookup returns client for known service', () => {
  const registry = new ServiceClientRegistry(parseServiceClientRegistryConfig(JSON.stringify([
    { serviceId: 'svc', apiKey: 'key', scopes: ['profiles:read'] },
  ])));

  assert.equal(registry.lookup('svc')?.serviceId, 'svc');
  assert.equal(registry.lookup('unknown'), null);
});
