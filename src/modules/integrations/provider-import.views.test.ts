import test from 'node:test';
import assert from 'node:assert/strict';
import { mapConnectionView, mapProviderImportJobView } from './provider-import.views.js';
import type { ProviderImportConnectionRecord } from './provider-import-connections.repo.js';
import type { ProviderImportJobRecord } from './provider-import-jobs.repo.js';

test('mapConnectionView extracts connection fields', () => {
  const record: ProviderImportConnectionRecord = {
    id: 'conn-1',
    profileId: 'profile-1',
    provider: 'trakt',
    status: 'connected',
    stateToken: null,
    providerUserId: 'user-1',
    externalUsername: 'crispy',
    credentialsJson: {
      accessToken: 'secret',
      refreshToken: 'refresh',
      lastImportJobId: 'job-1',
      lastImportCompletedAt: '2026-03-25T00:00:00.000Z',
      lastRefreshAt: '2026-03-25T12:00:00.000Z',
    },
    createdByUserId: 'account-1',
    expiresAt: null,
    lastUsedAt: '2026-03-26T00:00:00.000Z',
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-26T00:00:00.000Z',
  };

  const view = mapConnectionView(record);

  assert.equal(view.id, 'conn-1');
  assert.equal(view.provider, 'trakt');
  assert.equal(view.status, 'connected');
  assert.equal(view.providerUserId, 'user-1');
  assert.equal(view.externalUsername, 'crispy');
  assert.equal(view.lastImportJobId, 'job-1');
  assert.equal(view.lastImportCompletedAt, '2026-03-25T00:00:00.000Z');
});

test('mapConnectionView normalizes date strings', () => {
  const record: ProviderImportConnectionRecord = {
    id: 'conn-1',
    profileId: 'profile-1',
    provider: 'simkl',
    status: 'connected',
    stateToken: null,
    providerUserId: 'user-2',
    externalUsername: 'simkl-user',
    credentialsJson: {
      lastImportCompletedAt: 'Wed Aug 09 2023 16:57:00 GMT+0000 (Coordinated Universal Time)',
    },
    createdByUserId: 'account-1',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-26T00:00:00.000Z',
  };

  const view = mapConnectionView(record);
  assert.equal(view.lastImportCompletedAt, '2023-08-09T16:57:00.000Z');
});

test('mapConnectionView returns null for missing fields', () => {
  const record: ProviderImportConnectionRecord = {
    id: 'conn-1',
    profileId: 'profile-1',
    provider: 'trakt',
    status: 'pending',
    stateToken: 'state',
    providerUserId: null,
    externalUsername: null,
    credentialsJson: {},
    createdByUserId: 'account-1',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: '2026-03-24T00:00:00.000Z',
    updatedAt: '2026-03-26T00:00:00.000Z',
  };

  const view = mapConnectionView(record);
  assert.equal(view.providerUserId, null);
  assert.equal(view.externalUsername, null);
  assert.equal(view.lastImportJobId, null);
  assert.equal(view.lastImportCompletedAt, null);
});

test('mapProviderImportJobView excludes profileGroupId', () => {
  const job: ProviderImportJobRecord = {
    id: 'job-1',
    profileId: 'profile-1',
    profileGroupId: 'group-1',
    provider: 'trakt',
    mode: 'replace_import',
    status: 'succeeded',
    requestedByUserId: 'account-1',
    connectionId: 'conn-1',
    checkpointJson: {},
    summaryJson: {},
    errorJson: {},
    createdAt: '2026-03-24T00:00:00.000Z',
    startedAt: '2026-03-24T00:01:00.000Z',
    finishedAt: '2026-03-24T00:02:00.000Z',
    updatedAt: '2026-03-24T00:02:00.000Z',
  };

  const view = mapProviderImportJobView(job);
  assert.equal(view.id, 'job-1');
  assert.equal('profileGroupId' in view, false);
  assert.equal(view.status, 'succeeded');
});
