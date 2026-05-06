import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../test-helpers.js';

seedTestEnv();

test('encryptSecret stores ciphertext and decryptSecret restores plaintext', async () => {
  const { encryptSecret, decryptSecret } = await import('./crypto.js');

  const plaintext = 'sk-or-v1-test-secret';
  const encrypted = encryptSecret(plaintext);

  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptSecret(encrypted), plaintext);
});
