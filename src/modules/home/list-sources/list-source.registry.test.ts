import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();
const { listSourceDescriptors, getListSource } = await import('./list-source.registry.js');

test('registry exposes all list sources with unique ids', () => {
  const descriptors = listSourceDescriptors();
  assert.equal(descriptors.length, 7);
  const ids = descriptors.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'source ids must be unique');
  assert.ok(getListSource('tmdb.discover-filtered'), 'filtered source registered');
});

test('every descriptor has a name, description, and configFields array', () => {
  for (const descriptor of listSourceDescriptors()) {
    assert.ok(descriptor.id, 'id present');
    assert.ok(descriptor.name, `name present for ${descriptor.id}`);
    assert.ok(descriptor.description, `description present for ${descriptor.id}`);
    assert.ok(Array.isArray(descriptor.configFields), `configFields array for ${descriptor.id}`);
  }
});

test('getListSource resolves known ids and returns null for unknown', () => {
  assert.ok(getListSource('tmdb.discover-filtered'));
  assert.ok(getListSource('home.continue-watching'));
  assert.equal(getListSource('does.not.exist'), null);
});
