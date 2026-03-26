import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeBuilderService } from './home-builder.service.js';
import type { CalendarItem, HydratedWatchItem } from '../watch/watch-read.types.js';

function createWatchItem(mediaKey: string): HydratedWatchItem {
  return {
    media: {
      id: mediaKey.replace(/:/g, '-'),
      mediaKey,
      mediaType: mediaKey.startsWith('movie:') ? 'movie' : 'episode',
      kind: mediaKey.startsWith('episode:') ? 'episode' : 'title',
      tmdbId: 1,
      showTmdbId: mediaKey.startsWith('episode:') ? 10 : null,
      seasonNumber: mediaKey.startsWith('episode:') ? 1 : null,
      episodeNumber: mediaKey.startsWith('episode:') ? 1 : null,
      title: mediaKey,
      subtitle: null,
      summary: null,
      overview: null,
      artwork: {
        posterUrl: null,
        backdropUrl: null,
        stillUrl: null,
      },
      images: {
        posterUrl: null,
        backdropUrl: null,
        stillUrl: null,
        logoUrl: null,
      },
      releaseDate: null,
      releaseYear: null,
      runtimeMinutes: null,
      rating: null,
      status: null,
    },
  };
}

function createCalendarItem(bucket: CalendarItem['bucket'], mediaKey: string): CalendarItem {
  const media = createWatchItem(mediaKey).media;
  return {
    bucket,
    media,
    relatedShow: media,
    airDate: null,
    watched: false,
  };
}

test('HomeBuilderService returns typed thin-client sections', () => {
  const service = new HomeBuilderService();

  const response = service.build({
    continueWatching: [createWatchItem('movie:tmdb:1')],
    history: [createWatchItem('movie:tmdb:2')],
    calendarItems: [
      createCalendarItem('up_next', 'episode:tmdb:10:1:2'),
      createCalendarItem('this_week', 'episode:tmdb:10:1:3'),
      createCalendarItem('recently_released', 'episode:tmdb:10:1:4'),
    ],
  });

  assert.equal(response.sections.length, 5);
  assert.deepEqual(response.sections.map((section) => section.id), [
    'continue-watching',
    'up-next',
    'this-week',
    'recently-released',
    'recent-history',
  ]);
  assert.equal(response.sections[1]?.items.length, 2);
  assert.equal(response.sections[3]?.items.length, 1);
});
