import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderImportConnectionRecord } from './provider-import-connections.repo.js';
import { mapConnectionView } from './provider-import.views.js';

test('mapConnectionView hides credentials and surfaces import status fields', () => {
  const connection: ProviderImportConnectionRecord = {
    id: 'connection-1',
    profileId: 'profile-1',
    provider: 'trakt',
    status: 'connected',
    stateToken: null,
    providerUserId: 'user-1',
    externalUsername: 'crispy',
    credentialsJson: {
      accessToken: 'secret',
      refreshToken: 'secret-refresh',
      lastImportJobId: 'job-9',
      lastImportCompletedAt: '2026-03-22T12:00:00.000Z',
    },
    createdByUserId: 'app-user-1',
    expiresAt: null,
    lastUsedAt: '2026-03-22T12:30:00.000Z',
    createdAt: '2026-03-22T11:00:00.000Z',
    updatedAt: '2026-03-22T12:30:00.000Z',
  };

  assert.deepEqual(mapConnectionView(connection), {
    id: 'connection-1',
    provider: 'trakt',
    status: 'connected',
    providerUserId: 'user-1',
    externalUsername: 'crispy',
    createdAt: '2026-03-22T11:00:00.000Z',
    updatedAt: '2026-03-22T12:30:00.000Z',
    lastUsedAt: '2026-03-22T12:30:00.000Z',
    lastImportJobId: 'job-9',
    lastImportCompletedAt: '2026-03-22T12:00:00.000Z',
  });
});
