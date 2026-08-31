import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

function makeCalendarCard(overrides: Record<string, unknown>) {
  const itemId = overrides.itemId as string ?? '00000000000000000000000000000694';
  const imageSets = overrides.imageSets as Record<string, Record<string, string>> | undefined;
  return {
    itemId,
    mediaType: 'episode',
    title: overrides.title as string ?? 'Third Episode',
    overview: overrides.overview as string | null ?? null,
    year: overrides.year as number | null ?? 2024,
    releaseDate: overrides.releaseDate as string | null ?? '2024-01-03',
    rating: overrides.rating as number | null ?? 8.5,
    maturityRating: overrides.maturityRating as string | null ?? null,
    genres: (overrides.genres as string[] | undefined) ?? ['Drama'],
    runtimeSeconds: overrides.runtimeSeconds as number | null ?? 2640,
    images: {
      artwork: imageSets?.artwork ?? { small: 'https://img.test/artwork.jpg', medium: 'https://img.test/artwork.jpg', large: 'https://img.test/artwork.jpg' },
      logo: imageSets?.logo ?? { small: 'https://img.test/logo.png', medium: 'https://img.test/logo.png', large: 'https://img.test/logo.png' },
      still: imageSets?.still ?? { small: 'https://img.test/still.jpg', medium: 'https://img.test/still.jpg', large: 'https://img.test/still.jpg' },
    },
    trailerUrl: overrides.trailerUrl as string | null ?? null,
    progress: null,
    parent: (overrides.parent as Record<string, unknown> | null) ?? {
      seriesItemId: '00000000000000000000000000000500',
      seriesTitle: overrides.seriesTitle as string | undefined ?? 'Test Show',
      seasonNumber: overrides.seasonNumber as number | null ?? 1,
      episodeNumber: overrides.episodeNumber as number | null ?? 3,
    },
    providerIds: (overrides.providerIds as Record<string, unknown> | null) ?? {
      tmdb: overrides.tmdbId as string ?? '694',
      tvdb: null,
      imdb: null,
    },
    airDate: overrides.airDate as string | null ?? '2024-01-03',
    bucket: overrides.bucket as string ?? 'up_next',
  };
}

test('calendar route returns canonical envelope fields', async (t) => {
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');
  const original = CalendarService.prototype.getCalendar;
  const itemKey = '00000000000000000000000000000694';

  t.after(() => {
    CalendarService.prototype.getCalendar = original;
  });

  CalendarService.prototype.getCalendar = async function (_userId, profileId) {
    const item = makeCalendarCard({
      itemId: itemKey,
      tmdbId: '694',
      title: 'Third Episode',
      seriesTitle: 'Example Show',
      year: 2024,
      rating: 8.5,
      runtimeSeconds: 2640,
      seasonNumber: 1,
      episodeNumber: 3,
      airDate: '2024-01-03',
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2024-01-02T00:00:00.000Z',
      items: [item],
    } as never;
  };

  const { registerCalendarRoutes } = await import('./calendar.js');
  const app = await buildTestApp(registerCalendarRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/calendar', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.profileId, 'profile-1');
  assert.equal(data.source, 'canonical_calendar');
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].itemId, itemKey);
  assert.equal(data.items[0].mediaType, 'episode');
  assert.equal(data.items[0].title, 'Third Episode');
  assert.equal(data.items[0].parent.seriesTitle, 'Example Show');
  assert.equal(data.items[0].parent.seasonNumber, 1);
  assert.equal(data.items[0].parent.episodeNumber, 3);
  assert.equal(data.items[0].airDate, '2024-01-03');
  assert.equal(data.items[0].bucket, 'up_next');
  assert.ok(data.items[0].images.logo);
  assert.ok(data.items[0].images.still);
  assert.ok(data.items[0].images.artwork);
});

test('calendar this-week route returns narrowed canonical envelope fields', async (t) => {
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');
  const original = CalendarService.prototype.getThisWeek;
  const itemKey = '00000000000000000000000000000695';

  t.after(() => {
    CalendarService.prototype.getThisWeek = original;
  });

  CalendarService.prototype.getThisWeek = async function (_userId, profileId) {
    const item = makeCalendarCard({
      itemId: itemKey,
      tmdbId: '695',
      title: 'Season Premiere',
      seriesTitle: 'Next Week Show',
      year: 2024,
      rating: 8.3,
      runtimeSeconds: 2760,
      seasonNumber: 2,
      episodeNumber: 1,
      airDate: '2024-01-05',
      bucket: 'this_week',
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2024-01-03T00:00:00.000Z',
      items: [item],
    } as never;
  };

  const { registerCalendarRoutes } = await import('./calendar.js');
  const app = await buildTestApp(registerCalendarRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/calendar/this-week', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].itemId, itemKey);
  assert.equal(data.items[0].title, 'Season Premiere');
  assert.equal(data.items[0].parent.seriesTitle, 'Next Week Show');
  assert.equal(data.items[0].parent.seasonNumber, 2);
  assert.equal(data.items[0].bucket, 'this_week');
});
