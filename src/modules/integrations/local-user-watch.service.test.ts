import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { LocalUserWatchService } = await import('./local-user-watch.service.js');

test('resolvePlaybackDecision: no runtime keeps item in progress and preserves resume point', () => {
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(120, null), { kind: 'in_progress', positionSeconds: 120 });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(0, null), { kind: 'ignored' });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(null, null), { kind: 'ignored' });
});

test('resolvePlaybackDecision: sub-floor reports are ignored, never stored or reset', () => {
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(2, 1000), { kind: 'ignored' });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(0, 1000), { kind: 'ignored' });
});

test('resolvePlaybackDecision: mid-progress stores resume position', () => {
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(50, 1000), { kind: 'in_progress', positionSeconds: 50 });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(500, 1000), { kind: 'in_progress', positionSeconds: 500 });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(800, 1000), { kind: 'in_progress', positionSeconds: 800 });
});

test('resolvePlaybackDecision: >= MaxResumePct or at end is played', () => {
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(910, 1000), { kind: 'played' });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(999, 1000), { kind: 'played' });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(1000, 1000), { kind: 'played' });
});

test('deleteHistory resolves cascade target ids for season, show, and episode', async (t) => {
  const { ContentIdentityRepository } = await import('../identity/content-identity.repo.js');

  ContentIdentityRepository.prototype.findChildContentIds = async function (
    _client: unknown,
    parentContentId: string,
    relationshipType: string,
  ): Promise<string[]> {
    if (relationshipType === 'season' && parentContentId === 'season-1') return ['ep-a', 'ep-b'];
    if (relationshipType === 'season' && parentContentId === 'show-1') return ['season-1', 'season-2'];
    if (relationshipType === 'series' && parentContentId === 'show-1') return ['ep-1', 'ep-2'];
    return [];
  };
  LocalUserWatchService.prototype.resolveEpisodePlayableItemId = async function (
    _series: string,
    _season: number,
    _episode: number,
  ): Promise<string | null> {
    return 'ep-target';
  };

  const service = new LocalUserWatchService();
  const resolve = (params: Record<string, unknown>) =>
    (service as unknown as {
      resolveHistoryTargetItemIds: (client: unknown, p: unknown) => Promise<string[]>;
    }).resolveHistoryTargetItemIds({}, params as never);

  assert.deepEqual(
    await resolve({ itemId: 'movie-1', mediaType: 'movie' }),
    ['movie-1'],
  );
  assert.deepEqual(
    await resolve({ itemId: 'ep-1', mediaType: 'episode' }),
    ['ep-1'],
  );
  assert.deepEqual(
    await resolve({ itemId: 'season-1', mediaType: 'season' }),
    ['season-1', 'ep-a', 'ep-b'],
  );
  assert.deepEqual(
    await resolve({ itemId: 'show-1', mediaType: 'show' }),
    ['show-1', 'ep-1', 'ep-2', 'season-1', 'season-2'],
  );
  assert.deepEqual(
    await resolve({ itemId: 'show-1', mediaType: 'show', seasonNumber: 1, episodeNumber: 3 }),
    ['ep-target'],
  );
});

test('resolveCascadeItemIds mirrors history targets for mark/unmark watched', async (t) => {
  const { ContentIdentityRepository } = await import('../identity/content-identity.repo.js');

  ContentIdentityRepository.prototype.findChildContentIds = async function (
    _client: unknown,
    parentContentId: string,
    relationshipType: string,
  ): Promise<string[]> {
    if (relationshipType === 'season' && parentContentId === 'season-1') return ['ep-a', 'ep-b'];
    if (relationshipType === 'season' && parentContentId === 'show-1') return ['season-1', 'season-2'];
    if (relationshipType === 'series' && parentContentId === 'show-1') return ['ep-1', 'ep-2'];
    return [];
  };
  LocalUserWatchService.prototype.resolveEpisodePlayableItemId = async function (
    _series: string,
    _season: number,
    _episode: number,
  ): Promise<string | null> {
    return 'ep-target';
  };

  const service = new LocalUserWatchService();
  const resolve = (itemId: string, mediaType: string, seasonNumber?: number, episodeNumber?: number) =>
    (service as unknown as {
      resolveCascadeItemIds: (client: unknown, i: string, m: string, s?: number, e?: number) => Promise<string[]>;
    }).resolveCascadeItemIds({}, itemId, mediaType as never, seasonNumber, episodeNumber);

  assert.deepEqual(await resolve('movie-1', 'movie'), ['movie-1']);
  assert.deepEqual(await resolve('ep-1', 'episode'), ['ep-1']);
  assert.deepEqual(await resolve('season-1', 'season'), ['season-1', 'ep-a', 'ep-b']);
  assert.deepEqual(await resolve('show-1', 'show'), ['show-1', 'ep-1', 'ep-2', 'season-1', 'season-2']);
  assert.deepEqual(await resolve('show-1', 'show', 1, 3), ['ep-target']);
});
