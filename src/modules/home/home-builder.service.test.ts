import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeBuilderService } from './home-builder.service.js';
import type { CalendarItem } from '../watch/watch-read.types.js';
import type { ContinueWatchingProductItem } from '../watch/watch-derived-item.types.js';

function createContinueWatchingItem(mediaType: 'movie' | 'show' | 'anime' = 'movie'): ContinueWatchingProductItem {
  return {
    media: {
      mediaKey: mediaType === 'movie' ? 'movie:tmdb:1' : 'show:tmdb:1',
      mediaType,
      provider: 'tmdb',
      providerId: '1',
      title: mediaType === 'movie' ? 'Example Movie' : 'Example Show',
      posterUrl: 'https://img.test/poster.jpg',
      backdropUrl: 'https://img.test/backdrop.jpg',
      releaseYear: 2024,
      rating: 8.1,
      genre: null,
      seasonNumber: mediaType === 'movie' ? null : 1,
      episodeNumber: mediaType === 'movie' ? null : 2,
      episodeTitle: mediaType === 'movie' ? null : 'Episode 2',
      airDate: mediaType === 'movie' ? null : '2024-01-01',
      runtimeMinutes: 42,
    },
    id: 'cw-1',
    progress: {
      positionSeconds: 120,
      durationSeconds: 3600,
      progressPercent: 3.33,
      lastPlayedAt: '2024-01-01T00:00:00.000Z',
    },
    lastActivityAt: '2024-01-01T00:00:00.000Z',
    origins: ['native'],
    dismissible: true,
  };
}

function createCalendarItem(bucket: CalendarItem['bucket']): CalendarItem {
  return {
    bucket,
    media: {
      mediaKey: 'episode:tmdb:10:1:3',
      mediaType: 'episode',
      provider: 'tmdb',
      providerId: '10:1:3',
      title: 'Episode 3',
      posterUrl: 'https://img.test/poster.jpg',
      backdropUrl: 'https://img.test/still.jpg',
      releaseYear: 2024,
      rating: 8.4,
      genre: null,
      seasonNumber: 1,
      episodeNumber: 3,
      episodeTitle: 'Episode 3',
      airDate: '2024-01-03',
      runtimeMinutes: 44,
    },
    relatedShow: {
      mediaKey: 'show:tmdb:10',
      mediaType: 'show',
      provider: 'tmdb',
      providerId: '10',
      title: 'Example Show',
      posterUrl: 'https://img.test/show-poster.jpg',
      releaseYear: 2024,
      rating: 8.2,
      genre: null,
      subtitle: null,
    },
    airDate: '2024-01-03',
    watched: false,
  };
}

test('build returns only continue watching and this week sections', () => {
  const service = new HomeBuilderService();

  const response = service.build({
    continueWatching: [createContinueWatchingItem()],
    calendarItems: [createCalendarItem('up_next'), createCalendarItem('this_week')],
  });

  assert.equal(response.continueWatching.id, 'continue-watching');
  assert.equal(response.continueWatching.layout, 'landscape');
  assert.equal(response.thisWeek.id, 'this-week');
  assert.equal(response.thisWeek.layout, 'landscape');
});

test('build keeps only this_week calendar items', () => {
  const service = new HomeBuilderService();

  const response = service.build({
    continueWatching: [],
    calendarItems: [createCalendarItem('up_next'), createCalendarItem('this_week')],
  });

  assert.equal(response.thisWeek.items.length, 1);
  assert.equal(response.thisWeek.items[0]?.media.providerId, '10:1:3');
});

test('continue watching section exposes landscape cards', () => {
  const service = new HomeBuilderService();
  const response = service.build({
    continueWatching: [createContinueWatchingItem('show')],
    calendarItems: [],
  });

  const item = response.continueWatching.items[0] as ContinueWatchingProductItem;
  assert.equal(item.media.backdropUrl, 'https://img.test/backdrop.jpg');
  assert.equal(item.media.seasonNumber, 1);
  assert.equal(item.media.episodeNumber, 2);
  assert.equal(item.media.episodeTitle, 'Episode 2');
});
