import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAvatarUrl, isSupportedDicebearStyle, SUPPORTED_DICEBEAR_STYLES } from './avatar-url.js';

const VALID = 'https://api.dicebear.com/v9/initials/svg?seed=Test';

test('accepts a valid Dicebear v9 url', () => {
  const result = validateAvatarUrl(VALID);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.url, VALID);
});

test('accepts null/undefined/empty as empty (no avatar)', () => {
  assert.equal(validateAvatarUrl(null).ok, true);
  assert.equal(validateAvatarUrl(undefined).ok, true);
  assert.equal(validateAvatarUrl('').ok, true);
  assert.equal(validateAvatarUrl('   ').ok, true);
});

test('rejects non-https protocol', () => {
  const result = validateAvatarUrl('http://api.dicebear.com/v9/initials/svg');
  assert.equal(result.ok, false);
});

test('rejects wrong host', () => {
  const result = validateAvatarUrl('https://evil.example.com/v9/initials/svg');
  assert.equal(result.ok, false);
});

test('rejects unsupported version', () => {
  const result = validateAvatarUrl('https://api.dicebear.com/v8/initials/svg');
  assert.equal(result.ok, false);
});

test('rejects unsupported style', () => {
  const result = validateAvatarUrl('https://api.dicebear.com/v9/not-a-style/svg');
  assert.equal(result.ok, false);
});

test('rejects unsupported format', () => {
  const result = validateAvatarUrl('https://api.dicebear.com/v9/initials/gif');
  assert.equal(result.ok, false);
});

test('rejects malformed path segment count', () => {
  const result = validateAvatarUrl('https://api.dicebear.com/v9/initials');
  assert.equal(result.ok, false);
});

test('isSupportedDicebearStyle matches the exported list', () => {
  for (const style of SUPPORTED_DICEBEAR_STYLES) {
    assert.equal(isSupportedDicebearStyle(style), true);
  }
  assert.equal(isSupportedDicebearStyle('nope'), false);
});
