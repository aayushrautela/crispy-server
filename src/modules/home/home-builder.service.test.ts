import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeBuilderService } from './home-builder.service.js';
import type { CalendarItem } from '../watch/watch-read.types.js';
import type { ContinueWatchingProductItem, WatchedProductItem } from '../watch/watch-derived-item.types.js';

function createProductItem(mediaKey: string): ContinueWatchingProductItem {
  const isEpisode = mediaKey.startsWith('episode:');
  return {
    media: {
      id: mediaKey.replace(/:/g, '-'),
      mediaKey,
      mediaType: isEpisode ? 'episode' : 'movie',
      kind: isEpisode ? 'episode' : 'title',
      provider: 'tmdb',
      providerId: isEpisode ? '10:s1:e1' : '1',
      parentMediaType: isEpisode ? 'show' : null,
      parentProvider: isEpisode ? 'tmdb' : null,
      parentProviderId: isEpisode ? '10' : null,
      tmdbId: 1,
      showTmdbId: isEpisode ? 10 : null,
      seasonNumber: isEpisode ? 1 : null,
      episodeNumber: isEpisode ? 1 : null,
      absoluteEpisodeNumber: null,
      title: mediaKey,
      subtitle: null,
      summary: null,
      overview: null,
      artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
      images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
      releaseDate: null,
      releaseYear: null,
      runtimeMinutes: null,
      rating: null,
      status: null,
    },
    detailsTarget: {
      kind: 'title',
      titleId: isEpisode ? '10' : mediaKey.replace(/:/g, '-'),
      titleMediaType: isEpisode ? 'show' : 'movie',
      highlightEpisodeId: isEpisode ? mediaKey.replace(/:/g, '-') : null,
    },
    playbackTarget: {
      contentId: mediaKey.replace(/:/g, '-'),
      mediaType: isEpisode ? 'episode' : 'movie',
      provider: 'tmdb',
      providerId: isEpisode ? '10:s1:e1' : '1',
      parentProvider: isEpisode ? 'tmdb' : null,
      parentProviderId: isEpisode ? '10' : null,
      seasonNumber: isEpisode ? 1 : null,
      episodeNumber: isEpisode ? 1 : null,
      absoluteEpisodeNumber: null,
    },
    episodeContext: isEpisode ? {
      episodeId: mediaKey.replace(/:/g, '-'),
      seasonNumber: 1,
      episodeNumber: 1,
      absoluteEpisodeNumber: null,
      title: mediaKey,
      airDate: null,
      runtimeMinutes: null,
      stillUrl: null,
      overview: null,
    } : null,
    id: 'cw-' + mediaKey.replace(/:/g, '-'),
    progress: {
      positionSeconds: 0,
      durationSeconds: null,
      progressPercent: 0,
    },
    lastActivityAt: '2024-01-01T00:00:00.000Z',
    origins: ['native'],
    dismissible: true,
  };
}

function createWatchedItem(mediaKey: string): WatchedProductItem {
  const base = createProductItem(mediaKey);
  const { id, progress, lastActivityAt, dismissible, ...rest } = base;
  return {
    ...rest,
    watchedAt: '2024-01-01T00:00:00.000Z',
  };
}

function createCalendarItem(bucket: CalendarItem['bucket'], mediaKey: string): CalendarItem {
  const isEpisode = mediaKey.startsWith('episode:');
  const media = {
    id: mediaKey.replace(/:/g, '-'),
    mediaKey,
    mediaType: isEpisode ? 'episode' as const : 'movie' as const,
    kind: isEpisode ? 'episode' as const : 'title' as const,
    provider: 'tmdb' as const,
    providerId: isEpisode ? '10:s1:e1' : '1',
    parentMediaType: isEpisode ? 'show' as const : null,
    parentProvider: isEpisode ? 'tmdb' as const : null,
    parentProviderId: isEpisode ? '10' : null,
    tmdbId: 1,
    showTmdbId: isEpisode ? 10 : null,
    seasonNumber: isEpisode ? 1 : null,
    episodeNumber: isEpisode ? 1 : null,
    absoluteEpisodeNumber: null,
    title: mediaKey,
    subtitle: null,
    summary: null,
    overview: null,
    artwork: { posterUrl: null, backdropUrl: null, stillUrl: null },
    images: { posterUrl: null, backdropUrl: null, stillUrl: null, logoUrl: null },
    releaseDate: null,
    releaseYear: null,
    runtimeMinutes: null,
    rating: null,
    status: null,
  };
  return { bucket, media, relatedShow: media, airDate: null, watched: false };
}

test('build returns typed sections with correct ordering', () => {
  const service = new HomeBuilderService();

  const response = service.build({
    continueWatching: [createProductItem('movie:tmdb:1')],
    history: [createWatchedItem('movie:tmdb:2')],
    calendarItems: [
      createCalendarItem('up_next', 'episode:tmdb:10:1:2'),
      createCalendarItem('this_week', 'episode:tmdb:10:1:3'),
      createCalendarItem('recently_released', 'episode:tmdb:10:1:4'),
    ],
  });

  assert.equal(response.sections.length, 5);
  assert.deepEqual(response.sections.map((s) => s.id), [
    'continue-watching', 'up-next', 'this-week', 'recently-released', 'recent-history',
  ]);
  assert.deepEqual(response.sections.map((section) => section.kind), [
    'watch', 'calendar', 'calendar', 'calendar', 'watch',
  ]);
  assert.deepEqual(response.sections.map((section) => section.source), [
    'canonical_watch', 'canonical_calendar', 'canonical_calendar', 'canonical_calendar', 'canonical_watch',
  ]);
});

test('build includes detailsTarget and playbackTarget in watch items', () => {
  const service = new HomeBuilderService();

  const response = service.build({
    continueWatching: [createProductItem('movie:tmdb:1')],
    history: [createWatchedItem('movie:tmdb:2')],
    calendarItems: [],
  });

  const cw = response.sections.find((s) => s.id === 'continue-watching');
  assert.ok(cw);
  assert.equal(cw.items.length, 1);
  const cwItem = cw.items[0] as ContinueWatchingProductItem;
  assert.equal(cwItem.detailsTarget.kind, 'title');
  assert.ok(cwItem.detailsTarget.titleId);
  assert.ok(cwItem.playbackTarget);

  const history = response.sections.find((s) => s.id === 'recent-history');
  assert.ok(history);
  assert.equal(history.items.length, 1);
  const historyItem = history.items[0] as WatchedProductItem;
  assert.equal(historyItem.detailsTarget.kind, 'title');
  assert.equal(historyItem.watchedAt, '2024-01-01T00:00:00.000Z');
});

test('build keeps up_next items only in up-next section', () => {
  const service = new HomeBuilderService();

  const response = service.build({
    continueWatching: [],
    history: [],
    calendarItems: [
      createCalendarItem('up_next', 'episode:tmdb:10:1:2'),
      createCalendarItem('this_week', 'episode:tmdb:10:1:3'),
      createCalendarItem('recently_released', 'episode:tmdb:10:1:4'),
    ],
  });

  const upNext = response.sections.find((s) => s.id === 'up-next');
  assert.equal(upNext?.items.length, 1);
  assert.equal(upNext?.items[0]?.media.mediaKey, 'episode:tmdb:10:1:2');
});

test('build keeps this_week items only in this-week section', () => {
  const service = new HomeBuilderService();

  const response = service.build({
    continueWatching: [],
    history: [],
    calendarItems: [
      createCalendarItem('up_next', 'episode:tmdb:10:1:2'),
      createCalendarItem('this_week', 'episode:tmdb:10:1:3'),
    ],
  });

  const thisWeek = response.sections.find((s) => s.id === 'this-week');
  assert.equal(thisWeek?.items.length, 1);
  assert.equal(thisWeek?.items[0]?.media.mediaKey, 'episode:tmdb:10:1:3');
});

test('build limits up-next to 10 items', () => {
  const service = new HomeBuilderService();
  const items = Array.from({ length: 15 }, (_, i) => createCalendarItem('up_next', `episode:tmdb:10:1:${i + 1}`));

  const response = service.build({ continueWatching: [], history: [], calendarItems: items });

  const upNext = response.sections.find((s) => s.id === 'up-next');
  assert.equal(upNext?.items.length, 10);
});

test('build handles empty inputs', () => {
  const service = new HomeBuilderService();

  const response = service.build({ continueWatching: [], history: [], calendarItems: [] });

  assert.equal(response.sections.length, 5);
  assert.equal(response.sections.every((s) => s.items.length === 0), true);
});
