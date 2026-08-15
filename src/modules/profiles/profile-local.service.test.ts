import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

// Import after env is seeded: profile-local.service pulls in config modules
// that read required env vars at module-load time.
const { isProfileNameConflict, PROFILE_NAME_UNIQUE_INDEX } = await import('./profile-local.service.js');

test('isProfileNameConflict detects the per-account name unique-index violation', () => {
  const err = {
    code: '23505',
    constraint: PROFILE_NAME_UNIQUE_INDEX,
    message: `duplicate key value violates unique constraint "${PROFILE_NAME_UNIQUE_INDEX}"`,
  };
  assert.equal(isProfileNameConflict(err), true);
});

test('isProfileNameConflict is false for unrelated errors', () => {
  assert.equal(isProfileNameConflict({ code: '23505', constraint: 'some_other_index' }), false);
  assert.equal(isProfileNameConflict({ code: '23502' }), false);
  assert.equal(isProfileNameConflict(new Error('boom')), false);
  assert.equal(isProfileNameConflict(null), false);
  assert.equal(isProfileNameConflict(undefined), false);
});
