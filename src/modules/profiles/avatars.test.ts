import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAvatarId, isSupportedAvatar, SUPPORTED_AVATARS, avatarFileName } from './avatars.js';

test('accepts every supported avatar id', () => {
  for (const id of SUPPORTED_AVATARS) {
    const result = validateAvatarId(id);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.id, id);
  }
});

test('rejects null/undefined/empty (avatar is mandatory)', () => {
  assert.equal(validateAvatarId(null).ok, false);
  assert.equal(validateAvatarId(undefined).ok, false);
  assert.equal(validateAvatarId('').ok, false);
  assert.equal(validateAvatarId('   ').ok, false);
  assert.equal(validateAvatarId(42).ok, false);
});

test('rejects unsupported ids', () => {
  assert.equal(validateAvatarId('avatar_99').ok, false);
  assert.equal(validateAvatarId('toon_1').ok, false);
  assert.equal(validateAvatarId('dicebear').ok, false);
  assert.equal(validateAvatarId('https://api.dicebear.com/v9/initials/svg').ok, false);
});

test('isSupportedAvatar matches the exported list', () => {
  for (const id of SUPPORTED_AVATARS) {
    assert.equal(isSupportedAvatar(id), true);
  }
  assert.equal(isSupportedAvatar('nope'), false);
  assert.equal(isSupportedAvatar(null), false);
});

test('avatarFileName returns <id>.png', () => {
  assert.equal(avatarFileName('avatar_01'), 'avatar_01.png');
});