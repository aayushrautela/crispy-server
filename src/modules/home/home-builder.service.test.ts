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
      provider: 'tmdb',
      providerId: mediaKey.startsWith('episode:') ? '10:s1:e1' : '1',
      parentMediaType: mediaKey.startsWith('episode:') ? 'show' : null,
      parentProvider: mediaKey.startsWith('episode:') ? 'tmdb' : null,
      parentProviderId: mediaKey.startsWith('episode:') ? '10' : null,
      tmdbId: 1,
      showTmdbId: mediaKey.startsWith('episode:') ? 10 : null,
      seasonNumber: mediaKey.startsWith('episode:') ? 1 : null,
      episodeNumber: mediaKey.startsWith('episode:') ? 1 : null,
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
  };
}

function createCalendarItem(bucket: CalendarItem['bucket'], mediaKey: string): CalendarItem {
  const media = createWatchItem(mediaKey).media;
  return { bucket, media, relatedShow: media, airDate: null, watched: false };
}

test('build returns typed sections with correct ordering', () => {
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
