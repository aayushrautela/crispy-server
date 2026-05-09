import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminBulkJobDedupeKey, normalizeTargets } from './admin-bulk-job.repo.js';

test('normalizeTargets trims, sorts, and removes duplicates', () => {
  assert.deepEqual(normalizeTargets([
    { accountId: ' b ', profileId: ' 2 ' },
    { accountId: 'a', profileId: '1' },
    { accountId: 'a', profileId: '1' },
    { accountId: '', profileId: '3' },
  ]), [
    { accountId: 'a', profileId: '1' },
    { accountId: 'b', profileId: '2' },
  ]);
});

test('buildAdminBulkJobDedupeKey is stable for equivalent explicit targets', () => {
  const first = buildAdminBulkJobDedupeKey({ type: 'explicit_targets' }, [
    { accountId: 'b', profileId: '2' },
    { accountId: 'a', profileId: '1' },
  ], 'admin');
  const second = buildAdminBulkJobDedupeKey({ type: 'explicit_targets' }, [
    { accountId: 'a', profileId: '1' },
    { accountId: 'b', profileId: '2' },
  ], 'admin');
  assert.equal(first, second);
});
