import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();
const { listSourceDescriptors, getListSource } = await import('./list-source.registry.js');

test('registry exposes all list sources with unique ids', () => {
  const descriptors = listSourceDescriptors();
  assert.equal(descriptors.length, 6);
  const ids = descriptors.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'source ids must be unique');
  assert.ok(getListSource('tmdb.trending'), 'tmdb trending source registered');
  assert.ok(getListSource('tmdb.popular'), 'tmdb popular source registered');
  assert.ok(getListSource('tmdb.trending-person'), 'tmdb trending person source registered');
  assert.ok(getListSource('tmdb.new-this-week'), 'tmdb new this week source registered');
  assert.ok(getListSource('tmdb.genre-fresh'), 'tmdb genre fresh source registered');
  assert.ok(getListSource('mdblist.public-list'), 'mdblist public list source registered');
});

test('every descriptor has a name, description, and configFields array', () => {
  for (const descriptor of listSourceDescriptors()) {
    assert.ok(descriptor.id, 'id present');
    assert.ok(descriptor.name, `name present for ${descriptor.id}`);
    assert.ok(descriptor.description, `description present for ${descriptor.id}`);
    assert.ok(Array.isArray(descriptor.configFields), `configFields array for ${descriptor.id}`);
  }
});

test('only mdblist.public-list is admin-creatable', () => {
  const creatable = listSourceDescriptors().filter((d) => d.adminCreatable === true);
  assert.deepEqual(creatable.map((d) => d.id), ['mdblist.public-list']);
});

test('getListSource resolves known ids and returns null for unknown', () => {
  assert.ok(getListSource('tmdb.trending'));
  assert.ok(getListSource('tmdb.popular'));
  assert.ok(getListSource('mdblist.public-list'));
  assert.equal(getListSource('trakt.trending'), null, 'trakt home sources removed');
  assert.equal(getListSource('tmdb.discover-filtered'), null, 'tmdb source removed');
  assert.equal(getListSource('home.continue-watching'), null, 'continue-watching is no longer a list source');
  assert.equal(getListSource('does.not.exist'), null);
});