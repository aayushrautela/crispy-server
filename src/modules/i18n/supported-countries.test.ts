import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_COUNTRIES,
  isSupportedCountryCode,
  normalizeCountryCode,
} from './supported-countries.js';

test('SUPPORTED_COUNTRIES includes common ISO-3166-1 alpha-2 codes', () => {
  const codes = new Set(SUPPORTED_COUNTRIES.map((c) => c.code));
  for (const expected of ['US', 'GB', 'IN', 'JP', 'BR', 'DE', 'FR', 'AU']) {
    assert.ok(codes.has(expected), `expected ${expected} to be supported`);
  }
});

test('isSupportedCountryCode is case-insensitive', () => {
  assert.equal(isSupportedCountryCode('US'), true);
  assert.equal(isSupportedCountryCode('us'), true);
  assert.equal(isSupportedCountryCode('XX'), false);
});

test('normalizeCountryCode returns uppercase canonical or null', () => {
  assert.equal(normalizeCountryCode('us'), 'US');
  assert.equal(normalizeCountryCode('  in  '), 'IN');
  assert.equal(normalizeCountryCode('GB'), 'GB');
  assert.equal(normalizeCountryCode('XX'), null);
  assert.equal(normalizeCountryCode(''), null);
  assert.equal(normalizeCountryCode(null), null);
  assert.equal(normalizeCountryCode(42), null);
});

test('normalizeCountryCode rejects non-alpha-2 garbage', () => {
  assert.equal(normalizeCountryCode('USA-13'), null);
  assert.equal(normalizeCountryCode('123'), null);
});
