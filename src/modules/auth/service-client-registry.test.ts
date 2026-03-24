import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ServiceClientRegistry,
  parseServiceClientRegistryConfig,
} from './service-client-registry.js';

test('parseServiceClientRegistryConfig returns normalized clients', () => {
  const clients = parseServiceClientRegistryConfig(JSON.stringify([
    {
      serviceId: ' external-recommendation-engine ',
      apiKey: ' secret-key ',
      scopes: ['profiles:read', 'watch:read', 'watch:read'],
      description: 'Engine',
    },
  ]));

  assert.deepEqual(clients, [
    {
      serviceId: 'external-recommendation-engine',
      apiKey: 'secret-key',
      scopes: ['profiles:read', 'watch:read'],
      description: 'Engine',
      status: 'active',
    },
  ]);
});

test('parseServiceClientRegistryConfig rejects missing fields and bad scopes', () => {
  assert.throws(
    () => parseServiceClientRegistryConfig(JSON.stringify([{ apiKey: 'key', scopes: ['profiles:read'] }])),
    /serviceId is required/,
  );

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

test('ServiceClientRegistry authenticate returns null for unknown or disabled clients', () => {
  const registry = new ServiceClientRegistry(parseServiceClientRegistryConfig(JSON.stringify([
    { serviceId: 'svc-active', apiKey: 'key-1', scopes: ['profiles:read'] },
    { serviceId: 'svc-disabled', apiKey: 'key-2', scopes: ['watch:read'], status: 'disabled' },
  ])));

  assert.equal(registry.authenticate('svc-active', 'key-1')?.serviceId, 'svc-active');
  assert.equal(registry.authenticate('svc-active', 'wrong-key'), null);
  assert.equal(registry.authenticate('svc-disabled', 'key-2'), null);
  assert.equal(registry.authenticate('missing', 'key'), null);
});
