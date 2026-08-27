import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePublicItemId } from '../identity/public-item-id.js';
import {
  mapContinueWatchingInternalRef,
  mapHistoryInternalRef,
  mapWatchStateInternalRef,
  type WatchReadRow,
} from './watch-read.mapper.js';

function cwRef(row: WatchReadRow) {
  const item = mapContinueWatchingInternalRef(row);
  if (!item) throw new Error('expected non-null Continue Watching ref');
  return item;
}

const showId = '00000000-0000-4000-8000-000000000001';
const movieId = '00000000-0000-4000-8000-000000000002';
const episodeId = '00000000-0000-4000-8000-000000000003';

test('mapHistoryInternalRef maps title-level show history', () => {
  const ref = mapHistoryInternalRef({
    item_id: showId,
    media_type: 'show',
    occurred_at: '2026-05-11T08:00:00.000Z',
  } as WatchReadRow);
  assert.equal(ref.itemId, encodePublicItemId(showId));
  assert.equal(ref.mediaType, 'show');
  assert.equal(ref.progress!.played, true);
  assert.equal(ref.progress!.lastPlayedAt, '2026-05-11T08:00:00.000Z');
});

test('mapHistoryInternalRef maps episode history', () => {
  const ref = mapHistoryInternalRef({
    item_id: episodeId,
    media_type: 'episode',
    occurred_at: '2026-05-14T08:00:00.000Z',
    title_item_id: showId,
    season_number: 1,
    episode_number: 3,
  } as WatchReadRow);
  assert.equal(ref.itemId, encodePublicItemId(episodeId));
  assert.equal(ref.mediaType, 'episode');
  assert.equal(ref.progress!.played, true);
});

test('mapContinueWatchingInternalRef maps movie progress', () => {
  const ref = cwRef({
    title_item_id: movieId,
    playable_item_id: movieId,
    media_type: 'movie',
    position_seconds: 120,
    duration_seconds: 7200,
    progress_bps: 167,
    last_activity_at: '2026-05-13T00:00:00.000Z',
  } as WatchReadRow);
  assert.equal(ref.itemId, encodePublicItemId(movieId));
  assert.equal(ref.mediaType, 'movie');
  assert.equal(ref.progress!.positionSeconds, 120);
  assert.equal(ref.progress!.progressBps, 167);
  assert.equal(ref.progress!.lastPlayedAt, '2026-05-13T00:00:00.000Z');
});

test('mapContinueWatchingInternalRef tolerates null title_item_id for movies', () => {
  const ref = cwRef({
    title_item_id: null,
    playable_item_id: movieId,
    media_type: 'movie',
    position_seconds: 120,
    duration_seconds: 7200,
    progress_bps: 167,
    last_activity_at: '2026-05-13T00:00:00.000Z',
  } as WatchReadRow);
  assert.equal(ref.itemId, encodePublicItemId(movieId));
  assert.equal(ref.mediaType, 'movie');
});

test('mapContinueWatchingInternalRef maps episode progress', () => {
  const ref = cwRef({
    title_item_id: showId,
    playable_item_id: episodeId,
    media_type: 'episode',
    position_seconds: 600,
    duration_seconds: 1800,
    progress_bps: 3333,
    last_activity_at: '2026-05-14T08:00:00.000Z',
  } as WatchReadRow);
  assert.equal(ref.itemId, encodePublicItemId(episodeId));
  assert.equal(ref.mediaType, 'episode');
  assert.equal(ref.progress!.positionSeconds, 600);
  assert.equal(ref.progress!.progressBps, 3333);
});

test('mapContinueWatchingInternalRef excludes legacy series-level without season/episode', () => {
  const ref = mapContinueWatchingInternalRef({
    title_item_id: showId,
    playable_item_id: showId,
    media_type: 'show',
    position_seconds: 600,
    duration_seconds: 1800,
    progress_bps: 3333,
    last_activity_at: '2026-05-14T08:00:00.000Z',
  } as WatchReadRow);
  assert.equal(ref, null);
});

test('mapWatchStateInternalRef resolves episode identity', () => {
  const ref = mapWatchStateInternalRef({
    item_id: episodeId,
    media_type: 'episode',
    season_number: 1,
    episode_number: 1,
    played: true,
    play_count: 1,
    last_played_at: '2026-05-16T00:00:00.000Z',
  } as WatchReadRow);
  assert.equal(ref.itemId, encodePublicItemId(episodeId));
  assert.equal(ref.mediaType, 'episode');
  assert.equal(ref.progress!.played, true);
});
